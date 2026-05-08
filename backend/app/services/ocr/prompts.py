"""
prompts.py
LLM OCR 提示词与输出 Schema 定义

参考 maintenance-ocr-demo/prompts.py，适配当前 OCRResult 结构。
"""

# ───────────────────────────────────────────────
# System Prompt：多模态模型抽取保养结算单信息
# ───────────────────────────────────────────────
SYSTEM_PROMPT = """你是一名专业的汽车保养结算单信息抽取专家。请仔细识别图片中的结算单/工单，按要求输出 JSON。

【字段抽取规则】
1. date：取"来厂日"或开单日期，格式 YYYY-MM-DD
2. mileage：取"里程数"整数（km），不带单位
3. maintenance_type：取"修理类型"字段的原始值（如"定期保养"、"一般修理"、"事故维修"、"保养+维修"等），直接输出不映射
4. service_store：取"特约店名"或"公司名"
5. next_mileage / next_date：取"下次预计保养里程/日期"
6. cost.original：取"合计金额"
   cost.discount：取"工费折扣"+"零件折扣"之和（若只有一项则取该项）
   cost.actual：original - discount（若无法计算则 null）
   注意：original/discount/actual 在图片上通常是分开显示的，_bbox 中必须分别标注三个金额各自的位置
7. items：逐行提取作业项目表格中的【每一个具体项目】
   - 【极其重要】必须完整提取表格中的所有行，不得遗漏任何一个项目！
   - 跳过纯分组父行（如单独的"保养"二字、"维修"二字等无具体内容的行）
   - 取每一行最具体的操作项目（如"更换机油滤清器"、"四轮定位"等）
   - 即使项目很多（超过10行），也必须全部提取，不要截断
   - quantity 为空默认 1，金额为空填 0
   - 含零部件号的行务必抽取 part_number
8. remark：取"备注"或"送修问题"

【严格要求】
- 仅输出 JSON，无任何解释、无 markdown 包裹
- 无法识别的字段填 null，禁止编造
- 金额为纯数字（不带 ¥/元）
- 每个一级字段附带 _confidence (0~1)
- 返回所有字段在图片上的归一化坐标（0~1），放入 _bbox 对象中，
  格式为 [x1, y1, x2, y2]（左上角→右下角）。
  若某字段在图片上无法定位，对应坐标填 null。
- items 中每行记录也返回对应坐标，放入 _items_bbox 数组中，
  每个元素格式为 [x1, y1, x2, y2]，与 items 顺序一一对应。"""


# ───────────────────────────────────────────────
# OUTPUT_SCHEMA：LLM 输出的目标格式
# 注意：_confidence / _bbox / _items_bbox 是元数据，前端据此做置信度展示和图片标注
# ───────────────────────────────────────────────
OUTPUT_SCHEMA = """{
  "date": "2018-03-22",
  "mileage": 27775,
  "maintenance_type": "保养+维修",
  "service_store": "北京华通伟业汽车销售服务有限公司",
  "next_mileage": 35000,
  "next_date": "2018-08-23",
  "cost": {
    "original": 507.00,
    "discount": 30.00,
    "actual": 477.00
  },
  "items": [
    {
      "name": "机油滤清器",
      "part_number": "15400-R5G-H01",
      "operation": "更换",
      "quantity": 1,
      "unit_price": 39,
      "parts_fee": 39,
      "labor_fee": 0,
      "other_fee": 0
    },
    {
      "name": "机油",
      "part_number": "08798-9031C",
      "operation": "更换",
      "quantity": 3.5,
      "unit_price": 56,
      "parts_fee": 196,
      "labor_fee": 30,
      "other_fee": 0
    }
  ],
  "remark": "检查车辆右前车窗升降费劲",
  "_confidence": {
    "date": 0.95,
    "mileage": 0.90,
    "maintenance_type": 0.85,
    "service_store": 0.85,
    "next_mileage": 0.80,
    "next_date": 0.80,
    "cost": 0.90,
    "items": 0.80,
    "remark": 0.75
  },
  "_bbox": {
    "date": [0.10, 0.08, 0.25, 0.12],
    "mileage": [0.10, 0.13, 0.22, 0.17],
    "maintenance_type": [0.10, 0.18, 0.30, 0.22],
    "service_store": [0.10, 0.23, 0.55, 0.27],
    "next_mileage": [0.10, 0.45, 0.25, 0.49],
    "next_date": [0.10, 0.50, 0.25, 0.54],
    "cost_original": [0.60, 0.75, 0.90, 0.80],
    "cost_discount": [0.60, 0.80, 0.90, 0.85],
    "cost_actual": [0.60, 0.85, 0.90, 0.90],
    "remark": [0.10, 0.92, 0.90, 0.98]
  },
  "_items_bbox": [
    [0.08, 0.55, 0.95, 0.62],
    [0.08, 0.63, 0.95, 0.70]
  ]
}"""


# ───────────────────────────────────────────────
# User Prompt：拼接图片后发送给模型的指令
# ───────────────────────────────────────────────
def build_user_prompt() -> str:
    return f"""请识别图片中的汽车保养结算单，严格按照以下 JSON 格式输出，不要输出任何 JSON 以外的文字：

{OUTPUT_SCHEMA}

注意：
- 无法识别的字段填 null
- _confidence 中每个值为 0~1 的浮点数，表示该字段的识别置信度
- items 数组中每条记录的 subtotal（小计）= parts_fee + labor_fee + other_fee（无需在输出中包含 subtotal，由前端计算）
- 所有金额为纯数字，不带货币符号
- 【关键】items 必须包含表格中的所有具体项目行，禁止遗漏或截断！如果有很多行就全部输出
- _bbox 中每个值为归一化坐标 [x1, y1, x2, y2]，范围 0~1，对应图片上该字段的位置
- _bbox 中 cost_original / cost_discount / cost_actual 分别标注三个金额在图片上的独立位置
- _items_bbox 数组与 items 数组顺序一一对应，记录每个保养项目行的位置
- 若某字段在图片上无法定位，对应坐标填 null"""
