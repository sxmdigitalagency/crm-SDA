#!/usr/bin/env python3
"""Comptage indépendant du filtre discover (spec 4.1.4), par une autre méthode que import-dbpr.mjs :
module csv de Python au lieu du lecteur maison, filtres réécrits ici, puis comparaison avec le comptage du script.

Usage (racine du dépôt, après import-dbpr.mjs) :
  python3 scripts/prospection/count-dbpr.py --file <fichier DBPR> [--local]

Limite : les deux comptages lisent le même gabarit de colonnes (dbpr-layout.json). Une erreur dans ce gabarit
ferait se tromper les deux de la même façon ; c'est pourquoi il doit être rempli depuis la doc officielle.
"""
import argparse
import collections
import csv
import json
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--file', required=True)
p.add_argument('--layout', default='scripts/prospection/dbpr-layout.json')
p.add_argument('--counts', default='.wrangler/prospection/import-dbpr.counts.json')
p.add_argument('--local', action='store_true')
a = p.parse_args()

layout = json.load(open(a.layout, encoding='utf-8'))
cols = layout['columns']
raw = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'crm-sda', '--local' if a.local else '--remote', '--json',
                      '--command', 'SELECT key, value FROM prospect_config'], capture_output=True, text=True, check=True).stdout
cfg = {r['key']: r['value'] for r in json.loads(raw)[0]['results']}

classes = {c.strip().upper() for c in cfg['target_license_classes'].split(',') if c.strip()}
counties = {c.strip().upper() for c in cfg['target_counties'].split(',') if c.strip()}
trade_of = json.loads(cfg['license_class_trade'])
state = cfg['target_state'].upper()
active = {v.upper() for v in layout['active_status_values']}


def get(row, key):
    i = cols.get(key)
    return row[i].strip() if i is not None and i < len(row) else ''


seen = set()
counts = collections.Counter()
with open(a.file, newline='', encoding='latin-1') as f:
    reader = csv.reader(f)
    if layout['has_header_row']:
        next(reader, None)
    for row in reader:
        cls = get(row, 'class_code').upper()
        county = get(row, 'county').upper()
        if layout.get('county_values') == 'code':
            county = (layout.get('county_codes') or {}).get(get(row, 'county'), '').upper()
        lic = get(row, 'license_number')
        if (cls in classes and get(row, 'status').upper() in active and county in counties and lic
                and (cols.get('state') is None or get(row, 'state').upper() == state) and lic not in seen):
            seen.add(lic)
            counts[(trade_of[cls], county.title())] += 1

script = {tuple(k.split('|')): v for k, v in json.load(open(a.counts, encoding='utf-8')).items()}
keys = sorted(set(counts) | set(script))
ok = True
print(f"{'métier':10}{'comté':16}{'python':>10}{'script':>10}")
for k in keys:
    mark = '' if counts[k] == script.get(k, 0) else '  ← écart'
    ok &= not mark
    print(f"{k[0]:10}{k[1]:16}{counts[k]:>10}{script.get(k, 0):>10}{mark}")
print(f"{'total':26}{sum(counts.values()):>10}{sum(script.values()):>10}")
print('Comptages identiques.' if ok else 'ÉCART : ne pas charger le SQL avant de l’avoir expliqué.')
sys.exit(0 if ok else 1)
