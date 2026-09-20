# -*- coding: utf-8 -*-
"""本地 zenew.db 单值查询/执行助手：python scripts/dbq.py "<SQL>"
SELECT 返回首行首列，其它语句无输出。"""
import sqlite3
import sys
import os

DB = os.path.join(os.environ['APPDATA'], 'com.zenew.app', 'zenew.db')


def main():
    if len(sys.argv) < 2:
        print('用法: python scripts/dbq.py "<SQL>"', file=sys.stderr)
        return 2
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute(sys.argv[1])
    rows = cur.fetchall()
    conn.commit()
    conn.close()
    if rows and len(rows[0]) == 1 and rows[0][0] is not None:
        print(rows[0][0])
    return 0


if __name__ == '__main__':
    sys.exit(main())
