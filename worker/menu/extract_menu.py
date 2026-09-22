import pymupdf, json, sys, statistics

GOLD = 0xf6a107
SKIP_TEXTS = {'Logo opdrachtgever', 'Dieetswens of allergie?', 'Laat het ons team weten,',
              'we helpen je graag.', 'Laat het ons team weten', 'we helpen je graag'}

# Diner-referentie (k=1): gekalibreerde correcties/ritme in CSS-px (artboard/2).
REF = dict(Ctop=14.95, titleCorr=19.65, headMt=-7.0, headMb=45.7, nameMb=7.5,
           dishMb=23.75, sectionGap=45.5, ingrRef=20.9, ingrLh=27.5)

def classify(s):
    f = s['font']; c = s['color']; sz = s['size']; txt = s['text'].strip()
    if txt in SKIP_TEXTS: return None
    if c == GOLD: return 'heading'
    if 'Pockota' in f and sz > 100: return 'title'
    if 'ExtraBold' in f: return 'name'
    if 'AreaNormal' in f: return 'ingr'  # Thin/Hairline/Light/Regular = ingredienten
    return None

def cluster_x(xs, tol=40):
    xs = sorted(xs); clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= tol: clusters[-1].append(x)
        else: clusters.append([x])
    return [min(c) for c in clusters]

def extract(page):
    spans = []
    for b in page.get_text('dict')['blocks']:
        if b.get('type') != 0: continue
        for l in b['lines']:
            for s in l['spans']:
                kind = classify(s)
                if not kind: continue
                spans.append(dict(kind=kind, x0=s['bbox'][0], y0=s['bbox'][1],
                                  x1=s['bbox'][2], sz=s['size'], text=s['text'].strip()))
    title = next((s for s in spans if s['kind'] == 'title'), None)
    content = [s for s in spans if s['kind'] != 'title']
    # kolommen via x0-clustering van koppen en namen
    anchors = [s['x0'] for s in content if s['kind'] in ('heading', 'name')]
    col_x = cluster_x(anchors)
    def col_of(x):
        return min(range(len(col_x)), key=lambda i: abs(col_x[i] - x))

    sizes = {k: statistics.median([s['sz'] for s in content if s['kind'] == k] or [0])
             for k in ('heading', 'name', 'ingr')}
    k = (sizes['ingr'] / 2) / REF['ingrRef'] if sizes['ingr'] else 1.0

    # ingredient-regelafstand meten
    ingr_ys = {}
    # bouw kolommen
    cols = [[] for _ in col_x]
    for c in content:
        cols[col_of(c['x0'])].append(c)
    columns = []
    ingr_deltas = []
    for ci, items in enumerate(cols):
        items.sort(key=lambda s: s['y0'])
        sections = []; cur_sec = None; cur_dish = None
        last_ingr_y = None; prev_kind = None; prev_y = None
        hs = sizes['heading'] or 72
        for s in items:
            if s['kind'] == 'heading':
                # meerregelige kop samenvoegen (bv. "Op de tafel staat het volgende klaar:")
                if (cur_sec is not None and not cur_sec['items'] and prev_kind == 'heading'
                        and prev_y is not None and s['y0'] - prev_y < 1.7 * hs):
                    cur_sec['heading'] += ' ' + s['text']
                else:
                    cur_sec = {'heading': s['text'], 'items': []}; sections.append(cur_sec)
                cur_dish = None; last_ingr_y = None
                prev_kind = 'heading'; prev_y = s['y0']; continue
            elif s['kind'] == 'name':
                if cur_sec is None:
                    cur_sec = {'heading': '', 'items': []}; sections.append(cur_sec)
                cur_dish = {'name': s['text'], '_ingr_lines': []}
                cur_sec['items'].append(cur_dish); last_ingr_y = None
                prev_kind = 'name'; prev_y = s['y0']
            elif s['kind'] == 'ingr' and cur_dish is not None:
                cur_dish['_ingr_lines'].append(s['text'])
                if last_ingr_y is not None: ingr_deltas.append(s['y0'] - last_ingr_y)
                last_ingr_y = s['y0']
                prev_kind = 'ingr'; prev_y = s['y0']
        # ingredient-regels samenvoegen -> segmenten op '|'
        for sec in sections:
            for d in sec['items']:
                joined = ' '.join(d.pop('_ingr_lines')).replace(' |', '|').replace('| ', '|')
                segs = [p.strip() for p in joined.split('|') if p.strip()]
                if segs: d['ingredients'] = segs
        columns.append([sec for sec in sections])

    minx = min(col_x)
    ingrLh = (statistics.median(ingr_deltas) / 2) if ingr_deltas else REF['ingrLh'] * k
    first_head_y = min([s['y0'] for s in content if s['kind'] == 'heading'], default=460)

    layout = {
        'marginLeft': round(minx / 2, 1),
        'top': round(first_head_y / 2 + REF['Ctop'] * k, 1),
        'sectionGap': round(REF['sectionGap'] * k, 1),
        'columns': [{'left': round((x - minx) / 2, 1),
                     'width': round((max([s['x1'] for s in cols[i]]) - x) / 2 + 6, 1)}
                    for i, x in enumerate(col_x)],
        'type': {'title': round(title['sz'] / 2, 2) if title else 99.75,
                 'heading': round(sizes['heading'] / 2, 2),
                 'name': round(sizes['name'] / 2, 2),
                 'ingr': round(sizes['ingr'] / 2, 2),
                 'ingrLh': round(ingrLh, 2)},
        'gaps': {'headMt': round(REF['headMt'] * k, 2), 'headMb': round(REF['headMb'] * k, 2),
                 'nameMb': round(REF['nameMb'] * k, 2), 'dishMb': round(REF['dishMb'] * k, 2)},
    }
    if title:
        layout['title'] = {'left': round(title['x0'] / 2, 1),
                           'top': round(title['y0'] / 2 + REF['titleCorr'] * k, 1),
                           'size': round(title['sz'] / 2, 2)}
    # Voetregel: positie uit het gouden bestek-icoon + de "Dieetswens"-tekst.
    gold_xs, gold_ys = [], []
    for dd in page.get_drawings():
        f = dd.get('fill')
        if f and tuple(round(c, 2) for c in f) == (0.96, 0.63, 0.03):
            r = dd['rect']; gold_xs += [r.x0]; gold_ys += [r.y0]
    diet = None
    for b in page.get_text('dict')['blocks']:
        if b.get('type') != 0: continue
        for l in b['lines']:
            for s in l['spans']:
                if s['text'].strip() == 'Dieetswens of allergie?': diet = s['bbox']
    if gold_xs and diet:
        layout['footer'] = {'left': round(min(gold_xs) / 2, 1),
                            'top': round(diet[1] / 2 + 12.5, 1)}
    return {'title': title['text'] if title else '',
            'brand': {'accent': '#f6a107', 'blobTop': '#f6a107', 'blobBottom': '#229d96', 'logo': None},
            'layout': layout, 'columns': columns}

if __name__ == '__main__':
    doc = pymupdf.open('designs.pdf')
    for pi, name in [(0, 'lunch'), (2, 'lunch-vega'), (4, 'grab-and-go'), (5, 'buffet'), (7, 'diner-auto')]:
        data = extract(doc[pi])
        json.dump(data, open(f'menu-{name}.json', 'w'), ensure_ascii=False, indent=2)
        print(f'{name}: {len(data["columns"])} kolommen, type={data["layout"]["type"]}')
