# OpenStreetMap の地域ファイル（Geofabrik の .osm.pbf）から、暮らしの店だけを抜き出して JSON にする。
# 月に1回ほど手で回す：~/.venv-osm/bin/python server/poi_extract.py data/osm/chubu-latest.osm.pbf data/osm/poi-chubu.json
# 画面には出さない作業用データ。AIへ「近くの店」を渡すために使う（出典：© OpenStreetMap contributors）。
import json, sys
import osmium

KINDS = {  # shop=… → 呼び名
    "supermarket": "スーパー", "convenience": "コンビニ", "mall": "ショッピングセンター",
    "department_store": "百貨店", "drugstore": "ドラッグストア", "doityourself": "ホームセンター", "hardware": "ホームセンター",
}
AMENITY = {"pharmacy": "ドラッグストア"}

class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.out = []
    def add(self, tags, lat, lon):
        k = KINDS.get(tags.get("shop", "")) or AMENITY.get(tags.get("amenity", ""))
        if not k: return
        name = tags.get("name") or tags.get("brand") or ""
        self.out.append([k, name, tags.get("brand", ""), round(lat, 6), round(lon, 6)])
    def node(self, n):
        if n.tags: self.add(n.tags, n.location.lat, n.location.lon)
    def area(self, a):  # 建物の形で描かれた店は、外周の平均を位置にする
        try:
            pts = [(p.lat, p.lon) for ring in a.outer_rings() for p in ring]
            if pts: self.add(a.tags, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        except Exception:
            pass

src, dst = sys.argv[1], sys.argv[2]
h = H(); h.apply_file(src, locations=True)
json.dump({"source": "© OpenStreetMap contributors", "file": src.split("/")[-1], "count": len(h.out), "poi": h.out}, open(dst, "w"), ensure_ascii=False)
print(len(h.out), "件")
