from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import subprocess, math, os

W, H, FPS, DURATION = 1280, 720, 30, 60
OUT = Path(__file__).with_name('booktree-demo.mp4')
ROOT = Path(__file__).resolve().parents[1]
ICON = ROOT / 'icons' / 'icon-128.png'

COL = {
    'bg': (8, 17, 31), 'panel': (15, 24, 40), 'panel2': (20, 32, 52),
    'line': (56, 189, 248), 'muted_line': (36, 90, 130), 'text': (237, 247, 255),
    'muted': (145, 167, 189), 'accent': (34, 211, 238), 'orange': (245, 158, 11),
    'match': (250, 204, 21), 'blue': (96, 165, 250), 'green': (52, 211, 153),
    'danger': (251, 113, 133), 'white': (255,255,255)
}

def font(size, bold=False):
    candidates = [
        r'C:\Windows\Fonts\segoeuib.ttf' if bold else r'C:\Windows\Fonts\segoeui.ttf',
        r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf',
    ]
    for p in candidates:
        if Path(p).exists(): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

F = {k: font(v[0], v[1]) for k,v in {
    'hero': (58, True), 'h1': (34, True), 'h2': (26, True), 'body': (21, False),
    'small': (15, False), 'tiny': (12, False), 'btn': (16, False), 'node': (14, True), 'node2': (11, False)
}.items()}

def ease(x):
    x = max(0, min(1, x)); return x*x*(3-2*x)

def lerp(a,b,t): return a+(b-a)*t

def blend(c1,c2,t): return tuple(int(lerp(a,b,t)) for a,b in zip(c1,c2))

def alpha_col(c,a): return (*c, a)

def text_center(draw, xy, txt, fnt, fill):
    box = draw.textbbox((0,0), txt, font=fnt)
    draw.text((xy[0]-(box[2]-box[0])/2, xy[1]-(box[3]-box[1])/2), txt, font=fnt, fill=fill)

def wrap_text(draw, text, fnt, max_w):
    words, lines, line = text.split(), [], ''
    for w in words:
        cand = (line + ' ' + w).strip()
        if draw.textbbox((0,0), cand, font=fnt)[2] <= max_w or not line:
            line = cand
        else:
            lines.append(line); line = w
    if line: lines.append(line)
    return lines

def bg():
    img = Image.new('RGB', (W,H), COL['bg'])
    overlay = Image.new('RGBA', (W,H), (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    for cx,cy,r,col,a in [(220,90,360,COL['accent'],26),(1040,120,420,(37,99,235),38),(730,640,460,(20,184,166),14)]:
        d.ellipse((cx-r,cy-r,cx+r,cy+r), fill=alpha_col(col,a))
    overlay = overlay.filter(ImageFilter.GaussianBlur(60))
    return Image.alpha_composite(img.convert('RGBA'), overlay)

def rounded(d, box, r, fill, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

def draw_browser(d, x,y,w,h, title='chrome://extensions'):
    rounded(d,(x,y,x+w,y+h),18,(9,16,29,245),(56,189,248,60),1)
    d.rounded_rectangle((x,y,x+w,y+44), radius=18, fill=(15,24,40,250))
    for i,c in enumerate([(251,113,133),(245,158,11),(52,211,153)]): d.ellipse((x+18+i*22,y+16,x+30+i*22,y+28), fill=c)
    rounded(d,(x+110,y+10,x+w-24,y+34),10,(8,17,31,255),(148,163,184,40),1)
    d.text((x+126,y+16), title, font=F['tiny'], fill=COL['muted'])

def draw_toolbar(d, summary='124 bookmarks · 18 folders', query='', active=None):
    d.rectangle((0,0,W,76), fill=(8,17,31,232))
    d.line((0,76,W,76), fill=(56,189,248,46), width=1)
    rounded(d,(18,17,60,59),10,(20,32,52,255),(56,189,248,80),1)
    if ICON.exists():
        ic = Image.open(ICON).convert('RGBA').resize((42,42))
        d._image.paste(ic,(18,17),ic)
    d.text((74,17),'BookTree', font=F['btn'], fill=COL['text'])
    d.text((74,40),summary, font=F['tiny'], fill=COL['muted'])
    rounded(d,(348,17,790,59),13,(15,24,40,245),(34,211,238,220 if query else 70),2 if query else 1)
    d.text((366,30), query or 'Search titles and URLs…', font=F['small'], fill=COL['text'] if query else COL['muted'])
    labels=['−','+','Fit','Reset','Expand','Collapse']; x=814
    for lab in labels:
        ww = 38 if lab in ['−','+'] else (72 if lab=='Collapse' else 58)
        rounded(d,(x,19,x+ww,57),11,(24,42,68,255) if active==lab else (20,32,52,245),(34,211,238,185 if active==lab else 65),1)
        text_center(d,(x+ww/2,38),lab,F['btn'] if lab not in ['−','+'] else F['body'],COL['text'])
        x += ww+8

def node(d,x,y,title,sub='',kind='folder',match=False,collapsed=False,scale=1):
    w,h = 176*scale, 38*scale
    outline = COL['match'] if match else (COL['accent'] if kind=='folder' else COL['blue'])
    rounded(d,(x,y,x+w,y+h),9,(15,24,40,252),(*outline,220),2 if match else 1)
    d.ellipse((x+10,y+h/2-5,x+20,y+h/2+5), fill=(15,24,40), outline=COL['blue'], width=1)
    d.text((x+29,y+7),title[:18],font=F['node'],fill=COL['text'])
    if sub: d.text((x+29,y+23),sub[:25],font=F['node2'],fill=COL['muted'])
    if kind=='folder':
        rounded(d,(x+w-27,y+9,x+w-9,y+27),5,(34,211,238,38),(*COL['accent'],190),1)
        text_center(d,(x+w-18,y+18),'+' if collapsed else '−',F['tiny'],COL['text'])

def draw_tree(d, t=1, search=False, zoom=1, pan=(0,0), collapsed=False):
    ox,oy = 92+pan[0], 132+pan[1]
    def tx(p): return (ox+p[0]*zoom, oy+p[1]*zoom)
    nodes=[((0,240),'Bookmarks','124 bookmarks','folder',False,False),((230,80),'Bookmarks bar','46 bookmarks','folder',False,False),((230,230),'Reading','18 bookmarks','folder',search,False),((230,380),'Recipes','12 bookmarks','folder',False,collapsed),((460,25),'Docs','developer.chrome.com','bookmark',search,False),((460,85),'MDN Web Docs','developer.mozilla.org','bookmark',search,False),((460,160),'Design systems','figma.com','bookmark',False,False),((460,230),'Article queue','14 bookmarks','folder',search,False),((690,205),'Chrome APIs','developer.chrome.com','bookmark',search,False),((690,260),'SVG layouts','observablehq.com','bookmark',False,False),((460,370),'Pasta night','example.com','bookmark',False,False)]
    links=[(0,1),(0,2),(0,3),(1,4),(1,5),(1,6),(2,7),(7,8),(7,9),(3,10)]
    prog=ease(t)
    # links first
    for a,b in links:
        if prog < b/len(nodes)*0.35: continue
        p1=tx((nodes[a][0][0]+176,nodes[a][0][1]+19)); p2=tx((nodes[b][0][0],nodes[b][0][1]+19))
        mid=(p1[0]+p2[0])/2
        col=COL['line'] if (search and (nodes[a][4] or nodes[b][4])) or not search else COL['muted_line']
        d.line((p1[0],p1[1],mid,p1[1],mid,p2[1],p2[0],p2[1]), fill=(*col,185), width=max(1,int(2*zoom)), joint='curve')
    for i,n in enumerate(nodes):
        if prog < i/len(nodes)*0.55: continue
        if collapsed and i in [10]: continue
        x,y=tx(n[0]); node(d,x,y,n[1],n[2],n[3],n[4],n[5],zoom)
    d.text((W-430,H-40),'Drag canvas to pan · wheel or buttons to zoom · click folders to expand',font=F['tiny'],fill=(203,213,225,190))

def caption(d, title, body, t=1):
    a=int(255*ease(t))
    rounded(d,(54,548,620,672),24,(9,16,29,220),(56,189,248,70),1)
    d.text((84,574), title, font=F['h2'], fill=alpha_col(COL['text'],a))
    y=612
    for line in wrap_text(d, body, F['body'], 480):
        d.text((84,y),line,font=F['body'],fill=alpha_col(COL['muted'],a)); y+=27

def draw_install_scene(d, local_t):
    draw_browser(d, 115,105,1050,510,'chrome://extensions')
    d.text((160,170),'Extensions',font=F['h1'],fill=COL['text'])
    rounded(d,(880,168,1035,204),18,(34,211,238,42),(*COL['accent'],120),1)
    d.text((902,177),'Developer mode',font=F['small'],fill=COL['text'])
    d.ellipse((1000,174,1026,198),fill=COL['accent'])
    rounded(d,(160,240,430,298),14,(20,32,52,255),(*COL['accent'],90),1)
    text_center(d,(295,269),'Load unpacked',F['body'],COL['text'])
    if local_t>0.35:
        rounded(d,(472,235,1040,430),16,(15,24,40,250),(56,189,248,60),1)
        d.text((510,270),'Select this project folder',font=F['h2'],fill=COL['text'])
        d.text((510,312),str(ROOT),font=F['small'],fill=COL['muted'])
        rounded(d,(510,355,695,394),10,(34,211,238,60),(*COL['accent'],150),1)
        d.text((532,365),'BookTree loaded',font=F['btn'],fill=COL['text'])
    caption(d,'Install locally','Enable Developer mode, choose Load unpacked, and select the BookTree project folder.',min(1,local_t*2))

def draw_open_scene(d, local_t):
    draw_browser(d, 82,96,1116,545,'Chrome toolbar')
    d.text((150,170),'Click the BookTree extension button',font=F['h1'],fill=COL['text'])
    x=945; y=155
    rounded(d,(x-20,y-20,x+98,y+62),16,(20,32,52,255),(*COL['accent'],100),1)
    if ICON.exists():
        ic=Image.open(ICON).convert('RGBA').resize((48,48)); d._image.paste(ic,(x,y),ic)
    d.text((x-8,y+56),'BookTree',font=F['tiny'],fill=COL['muted'])
    pulse=math.sin(local_t*math.pi*4)*0.5+0.5
    d.ellipse((x-18-pulse*14,y-18-pulse*14,x+66+pulse*14,y+66+pulse*14),outline=(*COL['accent'],int(160*(1-pulse))),width=3)
    if local_t>0.50:
        rounded(d,(310,275,970,410),22,(9,16,29,245),(*COL['line'],130),1)
        d.text((360,315),'BookTree opens your bookmark graph in a new tab',font=F['h2'],fill=COL['text'])
        d.text((360,356),'No account. No sync service. It reads Chrome bookmarks locally.',font=F['body'],fill=COL['muted'])
    caption(d,'Open BookTree','Pin it if you like, then click the toolbar button whenever you want the graph.',min(1,local_t*2))

def draw_app_scene(d, local_t, mode):
    query=''
    active=None; search=False; zoom=1; pan=(0,0); collapsed=False; summary='124 bookmarks · 18 folders'
    if mode=='search':
        query = 'docs'[:max(0,min(4,int(local_t*7)-1))]
        search = local_t>0.45; summary = '3 matches in 124 bookmarks' if search else summary
    if mode=='zoom':
        active = 'Fit' if local_t<0.28 else ('+' if local_t<0.55 else 'Reset')
        zoom = 1 + 0.35*ease((local_t-0.25)/0.35) - 0.20*ease((local_t-0.68)/0.25)
        pan = (-70*ease((local_t-0.25)/0.35), -40*ease((local_t-0.25)/0.35))
    if mode=='collapse':
        active = 'Collapse' if local_t>0.45 else 'Expand'
        collapsed = local_t>0.55
    draw_toolbar(d, summary, query, active)
    draw_tree(d, min(1,local_t*1.6), search=search, zoom=zoom, pan=pan, collapsed=collapsed)
    if mode=='tree': caption(d,'See every branch','Folders and bookmarks become a compact tree you can drag, pan, zoom, fit, and reset.',min(1,local_t*2))
    if mode=='search': caption(d,'Search titles and URLs','Type a few letters. BookTree filters to matching branches and highlights matching bookmarks.',min(1,local_t*2))
    if mode=='zoom': caption(d,'Navigate the graph','Use the mouse wheel or buttons to zoom, drag the canvas to pan, then Fit or Reset the view.',min(1,local_t*2))
    if mode=='collapse': caption(d,'Focus fast','Click folders or use Expand and Collapse to hide noise and keep the useful branches visible.',min(1,local_t*2))

def draw_open_bookmark(d, local_t):
    draw_toolbar(d,'3 matches in 124 bookmarks','docs')
    draw_tree(d,1,search=True)
    x,y=92+690,132+205
    # cursor
    cx,cy = int(lerp(1060,x+90,ease(local_t))), int(lerp(500,y+20,ease(local_t)))
    pts=[(cx,cy),(cx+3,cy+30),(cx+11,cy+22),(cx+20,cy+42),(cx+28,cy+38),(cx+19,cy+20),(cx+31,cy+20)]
    d.polygon(pts, fill=COL['white'], outline=(8,17,31))
    if local_t>0.62:
        rounded(d,(745,470,1130,580),18,(9,16,29,242),(*COL['match'],140),1)
        d.text((772,500),'Click: open in this tab',font=F['body'],fill=COL['text'])
        d.text((772,532),'Ctrl/Cmd-click: open in a new tab',font=F['body'],fill=COL['muted'])
    caption(d,'Open what you found','Left-click opens a bookmark. Ctrl-click or Cmd-click opens it in a new tab.',min(1,local_t*2))

def draw_title(d, local_t):
    if ICON.exists():
        ic=Image.open(ICON).convert('RGBA').resize((120,120)); d._image.paste(ic,(580,132),ic)
    text_center(d,(W/2,310),'BookTree',F['hero'],COL['text'])
    text_center(d,(W/2,370),'A compact, searchable tree graph for Chrome bookmarks',F['h2'],COL['muted'])
    rounded(d,(480,430,800,484),18,(34,211,238,45),(*COL['accent'],120),1)
    text_center(d,(640,457),'How to use the extension',F['body'],COL['text'])

def draw_outro(d, local_t):
    draw_toolbar(d,'124 bookmarks · 18 folders','')
    draw_tree(d,1,zoom=.82,pan=(-10,-20))
    shade=Image.new('RGBA',(W,H),(8,17,31,160)); d._image.alpha_composite(shade)
    text_center(d,(W/2,210),'BookTree in 3 steps',F['hero'],COL['text'])
    steps=['1. Load unpacked in Chrome extensions','2. Click the BookTree toolbar button','3. Search, zoom, expand, and open bookmarks']
    for i,s in enumerate(steps):
        rounded(d,(315,300+i*72,965,352+i*72),16,(15,24,40,245),(*COL['accent'],90),1)
        d.text((350,313+i*72),s,font=F['body'],fill=COL['text'])
    d.text((450,565),'Find bookmarks visually — without leaving Chrome.',font=F['h2'],fill=COL['muted'])

def frame(i):
    t=i/FPS
    img=bg(); d=ImageDraw.Draw(img,'RGBA'); d._image=img
    if t<4: draw_title(d,t/4)
    elif t<11: draw_install_scene(d,(t-4)/7)
    elif t<17: draw_open_scene(d,(t-11)/6)
    elif t<25: draw_app_scene(d,(t-17)/8,'tree')
    elif t<34: draw_app_scene(d,(t-25)/9,'search')
    elif t<43: draw_app_scene(d,(t-34)/9,'zoom')
    elif t<50: draw_app_scene(d,(t-43)/7,'collapse')
    elif t<55: draw_open_bookmark(d,(t-50)/5)
    else: draw_outro(d,(t-55)/5)
    # subtle progress bar
    d.rectangle((0,H-5,int(W*i/(DURATION*FPS)),H), fill=(*COL['accent'],180))
    return img.convert('RGB')

def main():
    OUT.parent.mkdir(exist_ok=True)
    cmd=['ffmpeg','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-preset','medium',str(OUT)]
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    total=DURATION*FPS
    for i in range(total):
        p.stdin.write(frame(i).tobytes())
        if i%120==0: print(f'rendered {i}/{total}')
    p.stdin.close(); rc=p.wait()
    if rc: raise SystemExit(rc)
    print(f'wrote {OUT}')

if __name__=='__main__': main()
