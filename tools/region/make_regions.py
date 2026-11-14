import re,glob,csv,math,openpyxl,collections
pos={};xy={}
for f in glob.glob("p34/P34-14_*.xml"):
    s=open(f,encoding="utf-8").read()
    p=dict(re.findall(r"<gml:Point gml:id=\"(p\d+)\">\s*<gml:pos>([\d.]+ [\d.]+)",s))
    for ref,code,cl in re.findall(r"#(p\d+)\"/>\s*<ksj:administrativeAreaCode[^>]*>(\d+)</ksj:administrativeAreaCode>\s*<ksj:publicOfficeClassification>(\d)",s):
        if cl=="1" and code not in xy: xy[code]=tuple(map(float,p[ref].split()))
wb=openpyxl.load_workbook("p14.xlsx",read_only=True);ws=wb.worksheets[0]
mun=[]
for r in ws.iter_rows(min_row=7,values_only=True):
    c,p,n,pop=r[0],r[1],r[2],r[5]
    if not c or c=="-" or not n or n=="-" or n.endswith("郡"): continue
    if n.endswith("区") and not c.startswith("13"): continue
    if n=="島しょ": continue
    mun.append(dict(code=c[:5],pref=p,name=n))
for a,b in (("04216","04423"),("40231","40305")):
    if b in xy: xy[a]=xy[b]
xy_nemuro=xy.get("01223")
for m in mun:
    if m["code"][:2]=="01" and m["code"] not in xy and xy_nemuro: xy[m["code"]]=xy_nemuro
R={};SHOW={}
for line in open("regions.txt",encoding="utf-8"):
    line=line.strip()
    if not line: continue
    pref,rest=line.split(" ",1)
    nm,cs=rest.split("[");cs=cs.rstrip("]")
    show,_,hid=cs.partition("|")
    R.setdefault(pref,[]).append((nm,show.split("・")+([h for h in hid.split("・")] if hid else [])))
    SHOW[(pref,nm)]=show.split("・")
byname={(m["pref"],m["name"]):m for m in mun}
miss=[]
for p,rs in R.items():
    for nm,cs in rs:
        for c in cs:
            if (p,c) not in byname or byname[(p,c)]["code"] not in xy: miss.append((p,c))
print("anchor miss",miss)
pcode={m["pref"]:m["code"][:2] for m in mun}
base="https://taskboard.asuscomm.com/RealEstate_app/sample/?r="
out=[];look=[];nox=[]
for p in sorted(R,key=lambda p:pcode[p]):
    rs=R[p];cnt=collections.Counter()
    for m in [m for m in mun if m["pref"]==p]:
        if m["code"] not in xy: nox.append(m["name"]); i=0
        else:
            a=xy[m["code"]];best=None
            for i,(nm,cs) in enumerate(rs):
                for c in cs:
                    b=xy.get(byname.get((p,c),{}).get("code"))
                    if not b: continue
                    d=math.hypot(a[0]-b[0],(a[1]-b[1])*math.cos(math.radians(a[0])))
                    if best is None or d<best[0]: best=(d,i)
            i=best[1]
        rid=f"{pcode[p]}-{i+1}";nm,cs=rs[i];cnt[i]+=1
        look.append([m["code"],p,m["name"],rid,nm,"・".join(SHOW[(p,nm)]),base+rid])
    for i,(nm,cs) in enumerate(rs):
        rid=f"{pcode[p]}-{i+1}"
        sh=SHOW[(p,nm)]
        members=[x[2] for x in look if x[3]==rid]
        out.append([p,rid,nm,"・".join(sh),cnt[i],"・".join(members),base+rid])
w=csv.writer(open("地区一覧.csv","w",encoding="utf-8-sig",newline=""));w.writerow(["都道府県","地区ID","地区名","代表の市","市区町村数","入る市区町村（全部）","送るURL"]);w.writerows(out)
w=csv.writer(open("逆引き.csv","w",encoding="utf-8-sig",newline=""));w.writerow(["団体コード","都道府県","市区町村","地区ID","地区名","タイトルの市","送るURL"]);w.writerows(sorted(look))
print(len(out),len(look),"位置なし",nox)
