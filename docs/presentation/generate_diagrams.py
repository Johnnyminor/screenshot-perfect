"""Generate matching SVG and 3840 x 2160 PNG presentation diagrams.

Requires Pillow. Run with: py -3 docs/presentation/generate_diagrams.py
"""

from pathlib import Path
from html import escape
import math
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
SCALE = 2
NAVY = '#162E40'
TEAL = '#087F83'
MUTED = '#516675'
LINE = '#92A6AF'
BG = '#F7F9FA'
LIGHT = '#E8F4F3'
BLUE = '#EDF2F7'
AMBER = '#956619'
PALE = '#FFF5DF'


class Diagram:
    def __init__(self, title, subtitle, number):
        self.im = Image.new('RGB', (1920*SCALE, 1080*SCALE), BG)
        self.draw = ImageDraw.Draw(self.im)
        self.svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">',
                    f'<title>{escape(title)}</title>', f'<desc>{escape(subtitle)}</desc>',
                    f'<rect width="1920" height="1080" fill="{BG}"/>']
        self.rect(60, 52, 8, 77, TEAL, radius=0)
        self.text(91, 49, 'LEX NYHEDSMONITOR', 19, TEAL, True)
        self.text(89, 79, title, 43, NAVY, True)
        self.text(90, 140, subtitle, 23, MUTED)
        self.line([(60, 1022), (1860, 1022)], '#D9E2E7', 1)
        self.text(60, 1040, 'IMPLEMENTED DESIGN  /  Repository review: 26 November 2026', 17, MUTED)
        self.text(1860, 1037, number, 21, TEAL, True, 'right')

    def font(self, size, bold=False):
        return ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf', round(size*SCALE))

    def text(self, x, y, text, size=23, color=NAVY, bold=False, align='left'):
        font = self.font(size, bold)
        width = self.draw.textlength(text, font=font)/SCALE
        left = x - width/2 if align == 'center' else x-width if align == 'right' else x
        self.draw.text((left*SCALE, y*SCALE), text, font=font, fill=color, anchor='lt')
        anchor = {'left': 'start', 'center': 'middle', 'right': 'end'}[align]
        self.svg.append(f'<text x="{x}" y="{y}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" fill="{color}" text-anchor="{anchor}" dominant-baseline="text-before-edge">{escape(text)}</text>')

    def rect(self, x, y, w, h, fill='white', stroke=None, radius=15, width=1.5):
        box = tuple(round(v*SCALE) for v in (x, y, x+w, y+h))
        self.draw.rounded_rectangle(box, round(radius*SCALE), fill=fill, outline=stroke, width=round(width*SCALE))
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke or "none"}" stroke-width="{width}"/>')

    def line(self, points, color=LINE, width=2.5, arrow=False, both=False, dashed=False):
        pts = [(round(x*SCALE), round(y*SCALE)) for x,y in points]
        if dashed:
            for (x1,y1),(x2,y2) in zip(pts,pts[1:]):
                length=math.hypot(x2-x1,y2-y1)
                for k in range(0, round(length), 20):
                    a,b=k/length,min((k+11)/length,1)
                    self.draw.line((x1+(x2-x1)*a,y1+(y2-y1)*a,x1+(x2-x1)*b,y1+(y2-y1)*b),fill=color,width=round(width*SCALE))
        else:
            self.draw.line(pts, fill=color, width=round(width*SCALE), joint='curve')
        self.svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in points)}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"'+(' stroke-dasharray="6 5"' if dashed else '')+'/>')
        if arrow: self.arrow(points[-2],points[-1],color)
        if both: self.arrow(points[1],points[0],color)

    def arrow(self, start, end, color):
        angle=math.atan2(end[1]-start[1],end[0]-start[0])
        points=[end,(end[0]-13*math.cos(angle)+6*math.sin(angle),end[1]-13*math.sin(angle)-6*math.cos(angle)),(end[0]-13*math.cos(angle)-6*math.sin(angle),end[1]-13*math.sin(angle)+6*math.cos(angle))]
        self.draw.polygon([(x*SCALE,y*SCALE) for x,y in points],fill=color)
        self.svg.append(f'<polygon points="{" ".join(f"{x},{y}" for x,y in points)}" fill="{color}"/>')

    def card(self, x,y,w,h,title,lines=(),fill='white',accent=TEAL,size=24):
        self.rect(x,y,w,h,fill,'#D4E0E5')
        self.rect(x+18,y+20,4,28,accent,radius=1)
        self.text(x+36,y+20,title,size,NAVY,True)
        for i,t in enumerate(lines): self.text(x+24,y+64+i*31,t,21,MUTED)

    def label(self,x,y,text,color=TEAL): self.text(x,y,text,18,color,True)

    def diamond(self,cx,cy,w,h,lines):
        points=[(cx,cy-h/2),(cx+w/2,cy),(cx,cy+h/2),(cx-w/2,cy)]
        self.draw.polygon([(x*SCALE,y*SCALE) for x,y in points], fill=LIGHT,outline=TEAL,width=3)
        self.svg.append(f'<polygon points="{" ".join(f"{x},{y}" for x,y in points)}" fill="{LIGHT}" stroke="{TEAL}" stroke-width="1.5"/>')
        for i,t in enumerate(lines): self.text(cx,cy-27+i*29,t,22,NAVY,True,'center')

    def save(self,name):
        self.im.save(OUT/f'{name}.png',dpi=(220,220))
        (OUT/f'{name}.svg').write_text('\n'.join(self.svg+['</svg>']),encoding='utf-8')


def architecture():
    d=Diagram('System architecture','Database-configured monitoring for pharma and medtech editors', '01 / 02')
    d.label(60,195,'TRIGGERS & EXTERNAL SOURCES')
    d.card(60,230,370,126,'Managed HTTP scheduler',['Every 15 minutes','POST /api/public/ingest'],BLUE)
    d.line([(430,290),(560,290)],TEAL,arrow=True)
    d.label(447,258,'Cron auth')
    d.card(60,410,370,345,'Source connectors',[
        'Publisher RSS / Atom',
        'Company announcements',
        'ClinicalTrials.gov',
        'PubMed / NCBI',
        'Google News RSS · opt-in',
        'Currents API · manual only',
        'URLs and searches stored in DB',
    ],size=25)
    d.line([(430,515),(560,515)],TEAL,arrow=True)
    d.label(450,479,'Content')

    d.rect(560,230,750,525,BLUE,'#C4D3DE',radius=20)
    d.text(588,250,'APPLICATION SERVER',18,TEAL,True)
    d.text(588,281,'TanStack Start on Cloudflare Workers',28,NAVY,True)
    d.card(590,337,690,82,'Protected entry points',[],fill='white',size=23)
    d.text(614,385,'Scheduled endpoint  /  team-member server functions',20,MUTED)
    d.card(590,449,365,142,'Shared ingestion pipeline',[
        'Due sources · pacing · retries',
        'Parse · normalize · deduplicate',
    ],size=24)
    d.card(590,620,365,105,'Pure triage rules',[
        'Company / topic match + score',
    ],LIGHT,size=24)
    d.line([(770,591),(770,620)],TEAL,arrow=True)
    d.card(985,449,295,276,'Manual Currents',[
        'Latest-news preview',
        'Returned to browser',
        '',
        'Selected search pilot',
        'Uses ingestion + storage',
        'Daily request budget',
    ],LIGHT,size=23)
    d.line([(770,419),(770,449)],TEAL,arrow=True)
    d.line([(1130,419),(1130,449)],TEAL,arrow=True)

    d.label(1440,195,'IDENTITY & PERSISTENCE')
    d.rect(1440,230,420,525,'white','#C4D3DE',radius=20)
    d.text(1468,251,'SUPABASE',18,TEAL,True)
    d.text(1468,283,'Auth + PostgreSQL',29,NAVY,True)
    d.card(1464,337,372,106,'Access control',[
        'Approved team + row-level security',
    ],BLUE,size=23)
    d.card(1464,463,372,106,'Configuration',[
        'Companies · topics · feeds',
    ],BLUE,size=23)
    d.card(1464,589,372,140,'Content & operations',[
        'Items · source links · matches',
        'Editor actions · runs · health',
    ],BLUE,size=23)
    d.line([(1310,515),(1440,515)],TEAL,arrow=True,both=True)
    d.label(1323,470,'Server DB')
    d.text(1323,493,'client',18,MUTED)

    d.card(560,861,750,126,'Editorial dashboard · React + TanStack Query',[
        'Overblik · Mine kolonner · Arkiv · Kilder · Virksomheder · Emner',
        'Filter and review stories; save status, notes and Lex references',
    ],fill='white',size=25)
    d.line([(1125,861),(1125,755)],TEAL,arrow=True,both=True)
    d.label(1143,791,'Manual calls')
    d.line([(1650,755),(1650,922),(1310,922)],TEAL,arrow=True,both=True)
    d.label(1390,851,'Browser client')
    d.text(1390,878,'Reads / writes under RLS',19,MUTED)
    d.card(60,837,370,150,'Database-driven rules',[
        'Company trigger maintains',
        'opt-in Google News feeds.',
    ],LIGHT,size=24)
    d.text(590,782,'Collection credentials and API keys remain on the server.',20,MUTED)
    d.save('lex-system-architecture')


def flowchart():
    d=Diagram('From source to editorial action','Scheduled collection, deterministic triage and human review', '02 / 02')
    d.label(60,196,'01  COLLECT')
    d.card(60,245,295,125,'Start collection',[
        '15-minute schedule',
        'or approved manual run',
    ],BLUE,size=24)
    d.card(420,245,295,125,'Lease + configuration',[
        'Prevent overlapping runs',
        'Load active sources / rules',
    ],size=23)
    d.line([(355,302),(420,302)],TEAL,arrow=True)
    d.diamond(875,302,230,145,['Source due', '& available?'])
    d.line([(715,302),(760,302)],TEAL,arrow=True)
    d.card(1100,245,310,125,'Fetch source',[
        'Pacing, retries, cooldowns',
        'Conditional HTTP caching',
    ],size=24)
    d.line([(990,302),(1100,302)],TEAL,arrow=True)
    d.label(1015,270,'Yes')
    d.card(1510,245,350,125,'Parse response',[
        'RSS / Atom, JSON or XML',
        'Validate dates and content',
    ],size=24)
    d.line([(1410,302),(1510,302)],TEAL,arrow=True)
    d.line([(875,374),(875,407)],AMBER,arrow=True)
    d.label(895,375,'No')
    d.rect(734,407,282,65,PALE,'#ECD9AF')
    d.text(875,426,'Defer to a later run',22,AMBER,True,'center')
    d.line([(1255,370),(1255,407)],AMBER,arrow=True,dashed=True)
    d.rect(1100,407,310,65,PALE,'#ECD9AF')
    d.text(1255,420,'Failure / unchanged: log',20,AMBER,True,'center')
    d.text(1255,446,'then continue with next source',18,AMBER,False,'center')

    d.label(60,505,'02  TRIAGE & STORE')
    d.card(1510,551,350,136,'Normalize',[
        'Canonical URL + headline',
        'Exclude items over 30 days old',
    ],size=25)
    d.line([(1685,370),(1685,551)],TEAL,arrow=True)
    d.card(1100,551,310,136,'Deduplicate',[
        'Reuse / refresh existing item',
        'Or prepare a new item',
    ],size=25)
    d.line([(1510,619),(1410,619)],TEAL,arrow=True)
    d.card(680,551,320,136,'Match + rank',[
        'Company aliases / topic terms',
        'Exclusions + source ownership',
    ],LIGHT,size=25)
    d.line([(1100,619),(1000,619)],TEAL,arrow=True)
    d.card(250,551,330,136,'Commit to database',[
        'Item + provenance + matches',
        'Transactional storage RPC',
    ],size=24)
    d.line([(680,619),(580,619)],TEAL,arrow=True)
    d.text(680,705,'Score: source 50% + match 40% + recency up to 10%',20,MUTED)
    d.text(680,737,'After collection: rematch archive and finalize run / source health.',20,MUTED)

    d.label(60,803,'03  REVIEW & USE')
    d.card(60,846,340,134,'Archive + dashboard',[
        'Stored stories under RLS',
        'Unmatched items in archive',
    ],BLUE,size=24)
    d.line([(415,687),(415,773),(230,773),(230,846)],TEAL,arrow=True)
    d.card(520,846,340,134,'Editor filters',[
        'Company / topic columns',
        'Date · source · relevance',
    ],size=25)
    d.line([(400,913),(520,913)],TEAL,arrow=True)
    d.card(980,846,340,134,'Human review',[
        'Open original · copy citation',
        'Mark read, dismissed or used',
    ],size=25)
    d.line([(860,913),(980,913)],TEAL,arrow=True)
    d.card(1440,846,420,134,'Record editorial use',[
        'Save note + Lex article reference',
        'Editor updates article in Lex',
    ],LIGHT,size=25)
    d.line([(1320,913),(1440,913)],TEAL,arrow=True)
    d.save('lex-collection-flowchart')


if __name__ == '__main__':
    architecture()
    flowchart()
    print('Created two SVG diagrams and two 3840 x 2160 PNG images.')
