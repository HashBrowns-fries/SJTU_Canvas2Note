"""
Canvas 课堂笔记生成 Pipeline

用法：
    python pipeline.py                        # 处理所有课程
    python pipeline.py --course-id 12345      # 处理指定课程
    python pipeline.py --list-courses         # 仅列出课程
"""
import argparse
from pathlib import Path

from config import NOTES_DIR
from canvas.client import CanvasClient
from asr.transcriber import transcribe_video
from parser.doc_parser import parse_document
from notes.generator import generate_notes


def safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in " ._-" else "_" for c in name).strip()


def process_course(client: CanvasClient, course: dict) -> None:
    course_id   = course["id"]
    course_name = safe_name(course.get("name", str(course_id)))
    print(f"\n{'='*60}")
    print(f"课程: {course_name}  (id={course_id})")
    print("="*60)

    # ── 1. 下载文档 ────────────────────────────────────────────────
    print("\n[1/3] 下载课件文档 ...")
    doc_paths = client.download_course_docs(course_id, course_name)
    print(f"  文档: {len(doc_paths)} 个")

    # ── 2. 下载并转录视频 ──────────────────────────────────────────
    print("\n[2/3] 下载并转录视频 ...")
    video_paths = client.download_course_videos(course_id, course_name)
    print(f"  视频: {len(video_paths)} 个")

    # 每个视频转录，合并为一份讲义（按文件名顺序）
    transcripts: dict[str, str] = {}
    for vp in sorted(video_paths):
        transcripts[vp.stem] = transcribe_video(vp)

    # ── 3. 生成笔记 ────────────────────────────────────────────────
    print("\n[3/3] 生成笔记 ...")
    course_notes_dir = NOTES_DIR / course_name
    course_notes_dir.mkdir(parents=True, exist_ok=True)

    if not doc_paths and not transcripts:
        print("  无内容，跳过")
        return

    if doc_paths:
        for doc_path in doc_paths:
            doc_text = parse_document(doc_path)
            # 尝试匹配同名视频；否则合并所有讲义
            matched = transcripts.get(doc_path.stem) or "\n\n".join(transcripts.values())
            notes = generate_notes(course_name, doc_text, matched, doc_path.name)
            out_path = course_notes_dir / (doc_path.stem + "_notes.md")
            out_path.write_text(notes, encoding="utf-8")
            print(f"  ✓ 笔记已保存: {out_path}")
    else:
        # 仅有视频，无文档
        full_transcript = "\n\n".join(
            f"### {stem}\n{text}" for stem, text in transcripts.items()
        )
        notes = generate_notes(course_name, "", full_transcript, "（无课件）")
        out_path = course_notes_dir / "lecture_notes.md"
        out_path.write_text(notes, encoding="utf-8")
        print(f"  ✓ 笔记已保存: {out_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--course-id", type=int, help="只处理指定课程 ID")
    parser.add_argument("--list-courses", action="store_true", help="列出所有课程后退出")
    args = parser.parse_args()

    client = CanvasClient()

    courses = client.list_courses()
    print(f"共 {len(courses)} 门课程")

    if args.list_courses:
        for c in courses:
            print(f"  [{c['id']}] {c.get('name', '')}")
        return

    if args.course_id:
        courses = [c for c in courses if c["id"] == args.course_id]
        if not courses:
            print(f"未找到课程 id={args.course_id}")
            return

    for course in courses:
        try:
            process_course(client, course)
        except Exception as e:
            print(f"  [error] 课程 {course.get('name')} 处理失败: {e}")


if __name__ == "__main__":
    main()
