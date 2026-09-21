# -*- coding: utf-8 -*-
"""构建知新词书数据：cet4/cet6/freq/basic 四本书 + 全量搜索索引 → Voyra public/zenew/dict/"""
import json, io, os, glob, sys

SRC = os.path.join(os.environ['LOCALAPPDATA'], 'Temp', 'vocab')
OUT = r'D:/Voyra 个人网站/public/zenew/dict'
os.makedirs(OUT, exist_ok=True)

def load_ndjson(paths):
    rows = []
    for p in paths:
        with io.open(p, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows

def kajweb_to_entries(rows):
    """kajweb/dict NDJSON → 统一词条 {w, uk, us, m:[{p,t}], s:[{e,c}], r}；同词去重保最全条目"""
    out = {}
    order = []
    for row in rows:
        wc = row['content']['word']['content']
        trans = [{'p': t.get('pos', ''), 't': t.get('tranCn', '')} for t in wc.get('trans') or [] if t.get('tranCn')]
        sents = []
        for s in (wc.get('sentence') or {}).get('sentences') or []:
            e = (s.get('sContent') or '').strip()
            c = (s.get('sCn') or '').strip()
            if e and c:
                sents.append({'e': e, 'c': c})
        e = {
            'w': row['headWord'].strip(),
            'uk': wc.get('ukphone') or '',
            'us': wc.get('usphone') or '',
            'm': trans,
            's': sents[:2],
            'r': row.get('wordRank', 0),
        }
        k = e['w'].lower()
        if k not in out:
            out[k] = e
            order.append(k)
        else:
            # 保留信息更全的（释义多者优先，其次例句多者）
            old = out[k]
            if (len(e['m']), len(e['s'])) > (len(old['m']), len(old['s'])):
                out[k] = e
    return [out[k] for k in order]

def seq_ranks(entries):
    """词序 = 词书出现顺序（跨卷连续编号）"""
    for i, e in enumerate(entries):
        e['r'] = i + 1
    return entries

# ---------- 1) 四级 / 六级 ----------
cet4 = seq_ranks(kajweb_to_entries(load_ndjson(glob.glob(SRC + '/cet4/*.json'))))
cet6 = seq_ranks(kajweb_to_entries(load_ndjson(glob.glob(SRC + '/cet6/*.json'))))

# ---------- 2) 基础英语 = 初中 → 高中（同词去重，初中优先） ----------
junior = kajweb_to_entries(load_ndjson(glob.glob(SRC + '/chuzhong/*.json')))
senior_raw = kajweb_to_entries(load_ndjson(glob.glob(SRC + '/gaozhong/*.json')))
seen = set()
basic = []
for e in junior:
    k = e['w'].lower()
    if k in seen: continue
    seen.add(k); basic.append(e)
for e in senior_raw:
    k = e['w'].lower()
    if k in seen: continue
    seen.add(k); basic.append(e)
basic = seq_ranks(basic)

# ---------- 3) 高频词 = BNC 词频序 4544 词（用 CET4 词条富化） ----------
freq_raw = json.load(io.open(SRC + '/freq.json', encoding='utf-8'))
cet4_map = {e['w'].lower(): e for e in cet4}
freq = []
for it in freq_raw:
    w = it['word'].strip().lower()
    base = cet4_map.get(w)
    if base:
        e = dict(base)
        e['r'] = it.get('priority', 0)
        if not e['s'] and it.get('cet4'):
            e['s'] = [{'e': it['cet4'], 'c': it.get('cet4zh', '')}]
    else:
        # 词频表独有词：解析 def 字段 "adj. 长的；v. 渴望"
        m = []
        for seg in (it.get('def') or '').split('；'):
            seg = seg.strip()
            if not seg: continue
            pos, _, tran = seg.partition('. ')
            m.append({'p': pos.strip()[:4] if '. ' in seg else '', 't': (tran if tran else seg).strip()})
        e = {'w': w, 'uk': (it.get('phonetic') or '').strip('/'), 'us': '', 'm': m or [{'p': '', 't': w}],
             's': ([{'e': it['cet4'], 'c': it.get('cet4zh', '')}] if it.get('cet4') else []), 'r': it.get('priority', 0)}
    freq.append(e)
freq.sort(key=lambda x: x['r'])

# ---------- 4) 搜索索引：全量（四书 + 考研 + 托福 + SAT） ----------
def simple_to_entries(path):
    arr = json.load(io.open(path, encoding='utf-8'))
    out = []
    for it in arr:
        m = [{'p': t.get('type', ''), 't': t.get('translation', '')} for t in it.get('translations') or [] if t.get('translation')]
        ph = [{'ph': p.get('phrase', ''), 't': p.get('translation', '')} for p in it.get('phrases') or [] if p.get('phrase')]
        out.append({'w': it['word'].strip().lower(), 'm': m, 'p': ph})
    return out

index = {}
def index_add(entries, src):
    for e in entries:
        k = e['w'].lower()
        slot = index.setdefault(k, {'w': k, 'm': [], 'p': [], 'src': []})
        if src not in slot['src']: slot['src'].append(src)
        got = {x['t'] for x in slot['m']}
        for t in e.get('m') or []:
            if t['t'] not in got and len(slot['m']) < 6:
                slot['m'].append(t); got.add(t['t'])
        gotp = {x['ph'] for x in slot['p']}
        for t in e.get('p') or []:
            if t['ph'] not in gotp and len(slot['p']) < 4:
                slot['p'].append(t); gotp.add(t['ph'])

for e in cet4 + cet6 + basic + freq:
    index_add([dict(e, p=[])] , 'dict')
index_add(simple_to_entries(SRC + '/kaoyan.json'), '考研')
index_add(simple_to_entries(SRC + '/tuofu.json'), '托福')
index_add(simple_to_entries(SRC + '/sat.json'), 'SAT')
index_list = sorted(index.values(), key=lambda x: x['w'])

# ---------- 输出 ----------
def dump(name, data):
    p = os.path.join(OUT, name)
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{name}: {os.path.getsize(p)//1024} KB")

dump('cet4.json', cet4)
dump('cet6.json', cet6)
dump('freq.json', freq)
dump('basic.json', basic)
dump('index.json', index_list)
print('词条合计: 四级%d 六级%d 高频%d 基础%d | 索引 %d 词' % (len(cet4), len(cet6), len(freq), len(basic), len(index_list)))
