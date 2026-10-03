# -*- coding: utf-8 -*-
"""查看 Zenew 本地库内容概况（判断有哪些数据可展示）"""
import sqlite3, io, os

db = os.path.join(os.environ['APPDATA'], 'com.zenew.app', 'zenew.db')
print('库文件:', db, os.path.getsize(db), 'bytes')
c = sqlite3.connect(db)
tables = [t[0] for t in c.execute("select name from sqlite_master where type='table'").fetchall()]
for t in tables:
    try:
        n = c.execute(f'select count(*) from "{t}"').fetchone()[0]
        print(f'  {t:<20} {n}')
    except Exception as e:
        print(f'  {t:<20} ERR {e}')

print('\n已学卡片(有状态):', c.execute('select count(*) from card_state where state!=0').fetchone()[0])
print('待复习:', c.execute('select count(*) from card_state cs join card c2 on c2.id=cs.card_id where c2.suspended=0 and cs.due<=? and cs.state!=0', ('2099-01-01T00:00:00Z',)).fetchone()[0])
print('词书课程:', [r for r in c.execute("select name, kind from course where kind='vocab'").fetchall()])
print('课程总数:', c.execute('select count(*) from course').fetchone()[0])
print('复习记录:', c.execute('select count(*) from review_log').fetchone()[0])
print('考试:', c.execute('select title, exam_date from exam').fetchall())
