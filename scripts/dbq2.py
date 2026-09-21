# -*- coding: utf-8 -*-
"""zenew.db JSON 行查询：python scripts/dbq2.py "<SQL>"  — 输出首行的 JSON 对象（多列可用）"""
import sqlite3, sys, os, json

DB = os.path.join(os.environ['APPDATA'], 'com.zenew.app', 'zenew.db')

def main():
    if len(sys.argv) < 2:
        print('用法: python scripts/dbq2.py "<SQL>"', file=sys.stderr)
        return 2
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(sys.argv[1])
    rows = cur.fetchall()
    conn.commit()
    conn.close()
    if rows:
        print(json.dumps({k: rows[0][k] for k in rows[0].keys()}, ensure_ascii=False))
    else:
        print('{}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
