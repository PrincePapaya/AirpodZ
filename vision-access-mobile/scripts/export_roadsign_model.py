import argparse
import json
import shutil
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Export a YOLO road-sign model for the mobile app."
    )
    parser.add_argument(
        "--weights",
        required=True,
        help="Path to the trained YOLO weights (.pt).",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Export image size.",
    )
    parser.add_argument(
        "--int8",
        action="store_true",
        help="Export an int8-quantized model. Requires a compatible environment.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parent.parent / "assets" / "models"),
        help="Target mobile asset directory.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit(
            "Ultralytics is not installed. Run `pip install ultralytics` first."
        ) from exc

    weights_path = Path(args.weights).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(weights_path))
    export_result = model.export(
        format="tflite",
        imgsz=args.imgsz,
        int8=args.int8,
        nms=False,
    )

    exported_tflite = Path(export_result)
    target_tflite = output_dir / "roadsign.tflite"
    shutil.copy2(exported_tflite, target_tflite)

    names = model.names
    if isinstance(names, dict):
        labels = [names[index] for index in sorted(names)]
    else:
        labels = list(names)

    manifest = {
        "modelBundled": True,
        "modelFile": target_tflite.name,
        "inputWidth": args.imgsz,
        "inputHeight": args.imgsz,
        "inputType": "uint8" if args.int8 else "float32",
        "labels": labels,
        "scoreThreshold": 0.35,
        "iouThreshold": 0.45,
        "postprocess": "yolov8_raw",
        "delegate": "auto",
    }

    manifest_path = output_dir / "roadsign_model.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote model to {target_tflite}")
    print(f"Wrote manifest to {manifest_path}")


if __name__ == "__main__":
    main()
