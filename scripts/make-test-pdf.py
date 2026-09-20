# 生成测试教材 PDF：含中文章节结构（数据库系统概论浓缩版）
import sys
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle

# 找一个可用的中文字体
FONT = None
for cand in [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]:
    if Path(cand).exists():
        FONT = cand
        break
assert FONT, "找不到中文字体"
pdfmetrics.registerFont(TTFont("CN", FONT, subfontIndex=0))

style_title = ParagraphStyle("t", fontName="CN", fontSize=18, leading=26, spaceBefore=14, spaceAfter=8)
style_body = ParagraphStyle("b", fontName="CN", fontSize=11.5, leading=20, spaceAfter=6)

CH1 = [
    ("第1章 数据库系统概述",
     "数据库（DB）是长期存储在计算机内、有组织的、可共享的数据集合。数据库管理系统（DBMS）是位于用户与操作系统之间的数据管理软件，负责数据的定义、操纵、查询与控制。数据库系统（DBS）由数据库、DBMS、应用程序和数据库管理员（DBA）组成。"
     "数据模型是对现实世界数据特征的抽象。常见的数据模型包括层次模型、网状模型、关系模型和面向对象模型。关系模型用二维表组织数据，表中的行称为元组，列称为属性，属性的取值范围称为域。"
     "关系的完整性约束包括实体完整性、参照完整性和用户定义的完整性。实体完整性要求主属性不能取空值；参照完整性要求外键的值必须参照存在的主键值或取空值。"),
    ("1.2 关系代数",
     "关系代数是一种抽象的查询语言，用对关系的运算来表达查询。传统的集合运算包括并、交、差和笛卡尔积。专门的关系运算包括选择、投影、连接和除法。"
     "选择运算从关系中选择满足给定条件的元组；投影运算从关系中选择若干属性列；连接运算是从两个关系的笛卡尔积中选取属性间满足一定条件的元组；除法运算用于查询……至少包含……这类问题。"),
]

CH2 = [
    ("第2章 SQL 语言",
     "SQL（结构化查询语言）集数据定义、数据查询、数据操纵和数据控制于一体。SQL 的数据定义功能包括模式定义、表定义、视图和索引的定义。"
     "SELECT 语句是 SQL 的核心。基本语法为 SELECT 列名 FROM 表名 WHERE 条件 GROUP BY 分组 HAVING 组条件 ORDER BY 排序。WHERE 作用于基本表或视图，HAVING 作用于分组后的组。"
     "连接查询涉及两个以上的表。内连接返回满足连接条件的行；外连接分为左外连接、右外连接和全外连接，外连接保留不满足条件的行并填充空值。"),
    ("2.2 视图与索引",
     "视图是从一个或几个基本表导出的虚拟表，数据库只存放视图的定义而不存放视图对应的数据。视图能够简化用户操作，并提供一定的逻辑独立性和安全性。"
     "索引是提高查询效率的有效手段。B+ 树索引支持范围查询与等值查询；哈希索引仅支持等值查询。索引虽然加快查询，但会降低插入、删除、更新的速度，并占用额外存储空间。"),
]

out = Path("C:/Users/李星历/Desktop/课程学习软件/Zenew/docs/test-textbook.pdf")
doc = SimpleDocTemplate(str(out), pagesize=A4, title="数据库系统概论（测试教材）")
story = []
for ch in (CH1, CH2):
    for title, body in ch:
        story.append(Paragraph(title, style_title))
        for para in [body[i:i+120] for i in range(0, len(body), 120)]:
            story.append(Paragraph(para, style_body))
        story.append(Spacer(1, 6*mm))
doc.build(story)
print("生成:", out)
