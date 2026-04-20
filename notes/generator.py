from openai import OpenAI
from config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL

_client = None

def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    return _client


SYSTEM_PROMPT = """你是一个专业的课堂笔记整理助手。

## 输入内容
你会收到两部分内容：
- 【课件】：PPT/PDF 中提取的结构化文字（包含章节标题和关键内容）
- 【讲义】：课堂录像的语音转录文字（包含老师的讲解、举例、推导）

## 输出要求
生成结构清晰、内容完整的 Markdown 讲义笔记，具体要求如下：

### 结构编排
- 一级标题（#）为课程名称
- 二级标题（##）对应课件的章节/讲次
- 三级标题（###）对应小节或重要概念
- 不得随意打乱课件原有结构，讲义内容填充到对应章节下

### 内容融合规则
- 讲义中老师的补充说明、举例、类比 → 融入对应小节的正文
- 讲义中的推导过程、计算步骤 → 保留为完整推导（用公式块或缩进）
- 讲义中的重点强调（如"这个必考"）→ 用 > 引用块标注
- 口语填充词（嗯、啊、这个那个）→ 删除

### 格式规范
- 公式用 $inline$ 或 $$block$$ LaTeX 格式
- 重要定义用 **粗体** 标注
- 关键术语第一次出现时附英文原文
- 代码块保留原格式
- 无内容章节可简略但不得省略

### 语言规范
- 主体内容用中文
- 专业术语首次出现附英文缩写（如 RMSE、Attention Mechanism）
- 人名/地名/书名保留原文
- 不做无谓翻译

## 格式约束
- 输出纯 Markdown，不要任何前缀说明
- 不要在最后写"以上即为..."等结语"""


def generate_notes(
    course_name: str,
    doc_text: str,
    transcript: str,
    doc_name: str = "",
) -> str:
    def smart_truncate(text: str, limit: int) -> str:
        """截断时优先在段落边界截断，避免截断句子中间"""
        if len(text) <= limit:
            return text
        # 从 limit 处向前找到最近的换行，再向后找到句号/分号/逗号
        chunk = text[:limit]
        # 找最后一个换行
        last_newline = chunk.rfind('\n')
        cutoff = last_newline if last_newline > limit * 0.7 else int(limit * 0.85)
        return text[:cutoff].rstrip()

    user_content = f"""课程：{course_name}
文件：{doc_name}

【课件】
{smart_truncate(doc_text, 12000)}

【讲义】
{smart_truncate(transcript, 16000)}"""

    print(f"[LLM] 生成笔记: {doc_name} ...")
    client = _get_client()
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_content},
        ],
        temperature=0.3,
        stream=True,
    )

    result = []
    for chunk in response:
        delta = chunk.choices[0].delta.content or ""
        print(delta, end="", flush=True)
        result.append(delta)
    print()
    return "".join(result)
