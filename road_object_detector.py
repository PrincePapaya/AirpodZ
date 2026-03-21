import argparse
import queue
import subprocess
import threading
import time
from collections import defaultdict
from pathlib import Path

import cv2
from ultralytics import YOLO


class LatestFrameCamera:
    """Continuously grabs frames so inference always uses the newest image."""

    def __init__(self, camera_index: int, width: int | None, height: int | None):
        self.cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(camera_index)

        if width:
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        if height:
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        self._lock = threading.Lock()
        self._frame = None
        self._running = True
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()

    def _reader(self):
        while self._running:
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.01)
                continue
            with self._lock:
                self._frame = frame

    def read(self):
        with self._lock:
            if self._frame is None:
                return None
            return self._frame.copy()

    def release(self):
        self._running = False
        self._thread.join(timeout=1.0)
        self.cap.release()


class SpeechWorker:
    """Speaks messages on a background thread so inference stays fast."""

    def __init__(self, enabled: bool = True, rate: int = 180):
        self.enabled = enabled
        self.rate = rate
        self._queue: queue.Queue[str] = queue.Queue(maxsize=4)
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True) if self.enabled else None

        if self._thread:
            self._thread.start()

    def _run(self):
        while self._running:
            try:
                text = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue
            self._speak_with_powershell(text, self.rate)

    @staticmethod
    def _speak_with_powershell(text: str, rate: int):
        safe_text = text.replace("'", "''")
        ps_rate = max(-10, min(10, round((rate - 180) / 12)))
        command = (
            "Add-Type -AssemblyName System.Speech; "
            "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$speaker.Rate = {ps_rate}; "
            f"$speaker.Speak('{safe_text}')"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    def say(self, text: str):
        if not self.enabled:
            return

        if self._queue.full():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass

        try:
            self._queue.put_nowait(text)
        except queue.Full:
            pass

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run a YOLOv8 road-sign model on a live webcam feed and speak alerts."
    )
    parser.add_argument("--model", default="best.pt", help="Path to YOLO weights.")
    parser.add_argument("--camera", type=int, default=0, help="Webcam index.")
    parser.add_argument(
        "--conf",
        type=float,
        default=0.30,
        help="Confidence threshold. Lower values improve distant-sign recall.",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=960,
        help="Inference image size. Larger values help with smaller, distant signs.",
    )
    parser.add_argument(
        "--announce-gap",
        type=float,
        default=0.8,
        help="Minimum seconds between any two spoken announcements.",
    )
    parser.add_argument(
        "--frames-to-trigger",
        type=int,
        default=2,
        help="How many consecutive detected frames before speaking a sign.",
    )
    parser.add_argument(
        "--frames-to-reset",
        type=int,
        default=5,
        help="How many missed frames before a sign is treated as gone and can re-trigger.",
    )
    parser.add_argument(
        "--repeat-while-visible",
        type=float,
        default=9999.0,
        help="Repeat an alert if the same sign stays visible this many seconds.",
    )
    parser.add_argument("--width", type=int, default=1280, help="Capture width.")
    parser.add_argument("--height", type=int, default=720, help="Capture height.")
    parser.add_argument(
        "--device",
        default=None,
        help='Inference device such as "cpu", "0", or "0,1". Defaults to auto.',
    )
    parser.add_argument(
        "--no-speech",
        action="store_true",
        help="Disable speech output and only show detections on screen.",
    )
    return parser.parse_args()


def build_alert(label: str) -> str:
    return f"There may be a potential {label} ahead"


def main():
    args = parse_args()
    model_path = Path(args.model)
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    model = YOLO(str(model_path))
    if args.device is not None:
        model.to(args.device)

    camera = LatestFrameCamera(args.camera, args.width, args.height)
    speaker = SpeechWorker(enabled=not args.no_speech)

    present_streaks: dict[str, int] = defaultdict(int)
    missing_streaks: dict[str, int] = defaultdict(int)
    active_labels: set[str] = set()
    last_announced_at: dict[str, float] = defaultdict(float)
    last_global_announcement = 0.0
    last_fps_time = time.perf_counter()
    frame_counter = 0
    fps = 0.0

    print("Press Q in the video window to quit.")
    if not args.no_speech:
        print("Speech backend: Windows System.Speech")

    try:
        while True:
            frame = camera.read()
            if frame is None:
                time.sleep(0.01)
                continue

            results = model.predict(
                source=frame,
                conf=args.conf,
                imgsz=args.imgsz,
                device=args.device,
                verbose=False,
                stream=False,
            )
            result = results[0]
            annotated = result.plot()

            now = time.time()
            seen_labels = []

            for box in result.boxes:
                class_id = int(box.cls[0].item())
                label = model.names[class_id]
                seen_labels.append(label)

            current_labels = set(seen_labels)

            for label in current_labels:
                present_streaks[label] += 1
                missing_streaks[label] = 0

            tracked_labels = set(present_streaks) | set(missing_streaks) | set(last_announced_at) | set(active_labels)
            for label in tracked_labels - current_labels:
                present_streaks[label] = 0
                missing_streaks[label] += 1
                if missing_streaks[label] >= args.frames_to_reset:
                    active_labels.discard(label)
                    last_announced_at[label] = 0.0

            speak_queue = [
                label
                for label in sorted(current_labels)
                if present_streaks[label] >= args.frames_to_trigger
                and label not in active_labels
                and now - last_announced_at[label] >= args.repeat_while_visible
            ]

            if speak_queue and now - last_global_announcement >= args.announce_gap:
                label = speak_queue[0]
                speaker.say(build_alert(label))
                active_labels.add(label)
                last_announced_at[label] = now
                last_global_announcement = now

            frame_counter += 1
            elapsed = time.perf_counter() - last_fps_time
            if elapsed >= 1.0:
                fps = frame_counter / elapsed
                frame_counter = 0
                last_fps_time = time.perf_counter()

            cv2.putText(
                annotated,
                f"FPS: {fps:.1f}",
                (15, 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 255, 0),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                annotated,
                f"conf={args.conf:.2f} imgsz={args.imgsz}",
                (15, 70),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
                cv2.LINE_AA,
            )

            cv2.imshow("Road Sign Alerts", annotated)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        camera.release()
        speaker.stop()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
