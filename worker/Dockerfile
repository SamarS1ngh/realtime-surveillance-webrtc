FROM python:3.12-slim
WORKDIR /app

# ffmpeg for RTSP/PyAV; libgl + libglib for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch first, from the CPU wheel index — avoids pulling ~5GB of CUDA
# wheels we never use (inference here is CPU-bound by design).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.4.1 torchvision==0.19.1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# bake the YOLOv8n weights into the image so the first camera start is instant
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY . .

CMD ["python", "-m", "app.main"]
