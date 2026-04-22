#!/usr/bin/env python3
"""
快速测试 VLM 截图分析（依赖 vLLM 服务运行在 localhost:8080）
"""
import sys
from pathlib import Path

from vlm_client import describe_frame, health_check

img = Path(__file__).parent / "data" / "frames" / "test.jpg"

if not health_check():
    print("[!] vLLM 服务未启动，请先运行：")
    print("    vllm serve Qwen/Qwen3-VL-8B-Instruct \\")
    print("      --tensor-parallel-size 1 --port 8080 --dtype half \\")
    print("      --gpu-memory-utilization 0.88 --max-model-len 8192 \\")
    print("      --trust-remote-code")
    sys.exit(1)

if not img.exists():
    print(f"[!] 测试图片不存在: {img}")
    print(f"    请放入测试图片，或指定路径：describe_frame('图片路径.png')")
    sys.exit(1)

desc = describe_frame(img)
print(f"图片: {img}")
print(f"描述: {desc}")
