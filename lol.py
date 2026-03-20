import cv2
import numpy as np

def colorblind_filter(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    # --- RED REGION MASK (HSV) ---
    lower_red1 = np.array([0, 70, 50])
    upper_red1 = np.array([10, 255, 255])
    lower_red2 = np.array([170, 70, 50])
    upper_red2 = np.array([180, 255, 255])
    red_mask = cv2.bitwise_or(
        cv2.inRange(hsv, lower_red1, upper_red1),
        cv2.inRange(hsv, lower_red2, upper_red2)
    )

    # --- BLUE REGION MASK (HSV) ---
    lower_blue = np.array([100, 70, 50])
    upper_blue = np.array([130, 255, 255])
    blue_mask = cv2.inRange(hsv, lower_blue, upper_blue)

    # --- REGION COLOR SHIFTS ---
    hsv_shifted = hsv.copy()

    # Red region -> Blue hue (~120)
    hsv_shifted[..., 0] = np.where(red_mask == 255, 120, hsv_shifted[..., 0])

    # Blue region -> Red hue (~0)
    hsv_shifted[..., 0] = np.where(blue_mask == 255, 0, hsv_shifted[..., 0])

    filtered = cv2.cvtColor(hsv_shifted, cv2.COLOR_HSV2BGR)

    # --- STRICT PIXEL RULES ---
    output = filtered.copy()

    pure_red_mask  = frame[:, :, 2] == 255  # R channel
    pure_blue_mask = frame[:, :, 0] == 255  # B channel

    output[pure_red_mask]  = [255, 0, 0]   # Blue (BGR)
    output[pure_blue_mask] = [0, 0, 255]   # Red  (BGR)

    return output


cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    output = colorblind_filter(frame)

    combined = np.hstack((frame, output))
    cv2.imshow("Original | Filtered", combined)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()