import cv2
import numpy as np

# --- TOGGLES ---
swap_red_blue = True
yellow_to_cyan = True

def intensity_color_shift(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    # --- RED MASK (two hue ranges) ---
    red_mask1 = cv2.inRange(hsv, (0, 70, 50), (10, 255, 255))
    red_mask2 = cv2.inRange(hsv, (170, 70, 50), (180, 255, 255))
    red_mask = cv2.bitwise_or(red_mask1, red_mask2)

    # --- BLUE MASK ---
    blue_mask = cv2.inRange(hsv, (100, 70, 50), (130, 255, 255))

    # --- YELLOW MASK ---
    yellow_mask = cv2.inRange(hsv, (20, 70, 50), (35, 255, 255))

    h_new = h.copy()

    # --- RED ↔ BLUE SWAP (intensity preserved) ---
    if swap_red_blue:
        # Red hue → Blue hue (~120)
        h_new = np.where(red_mask == 255, 120, h_new)
        # Blue hue → Red hue (~0)
        h_new = np.where(blue_mask == 255, 0, h_new)

    # --- YELLOW → CYAN SHIFT ---
    if yellow_to_cyan:
        # Yellow hue (~25) → Cyan hue (~90)
        h_new = np.where(yellow_mask == 255, 90, h_new)

    hsv_shifted = cv2.merge([h_new, s, v])
    return cv2.cvtColor(hsv_shifted, cv2.COLOR_HSV2BGR)


cap = cv2.VideoCapture(0)

print("Controls: r = Red↔Blue | y = Yellow→Cyan | q = Quit")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    output = intensity_color_shift(frame)
    combined = np.hstack((frame, output))
    cv2.imshow("Original | Color Assist", combined)

    key = cv2.waitKey(1) & 0xFF

    if key == ord('r'):
        swap_red_blue = not swap_red_blue
        print(f"Red↔Blue: {'ON' if swap_red_blue else 'OFF'}")

    elif key == ord('y'):
        yellow_to_cyan = not yellow_to_cyan
        print(f"Yellow→Cyan: {'ON' if yellow_to_cyan else 'OFF'}")

    elif key == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
