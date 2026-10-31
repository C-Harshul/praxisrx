#!/usr/bin/env python3
"""Public metadata acquisition. No full text saved. Safe to rerun; local staging only."""
from zoneinfo import ZoneInfo
import argparse, datetime as dt, hashlib, html, json, pathlib, re, time, urllib.request, urllib.parse, urllib.error, uuid
ROOT=pathlib.Path(__file__).resolve().parent

def digest(x): return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def text(x): return html.unescape(re.sub('<[^>]*>', ' ', x or '')).strip()
def get(url):
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'MSL-research-KB/1.0 (public metadata; limited excerpts)'})
            with urllib.request.urlopen(req,timeout=40) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429,500,502,503,504) or attempt==3: raise
            time.sleep(min(30,float(e.headers.get('Retry-After','0')) or 2**attempt))
        except (urllib.error.URLError, TimeoutError):
            if attempt==3: raise
            time.sleep(2**attempt)
    raise RuntimeError('retry exhausted')

def search(query, limit=100):
    cursor='*'; out=[]; hits=0
    while len(out)<limit:
        url='https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+urllib.parse.urlencode({'query':query,'format':'json','pageSize':min(100,limit-len(out)),'resultType':'core','cursorMark':cursor})
        data=get(url); hits=data['hitCount']; out.extend(data['resultList']['result'])
        nxt=data.get('nextCursorMark')
        if not nxt or nxt==cursor or not data['resultList']['result']: break
        cursor=nxt; time.sleep(.5)
    return out,hits,cursor

def excerpt(abstract):
    plain=re.sub(r'\s+',' ',text(abstract))
    # A complete short sentence, preferentially a conclusion. No detached effect sizes.
    sentences=re.split(r'(?<=[.!?])\s+(?=[A-Z])',plain)
    choices=[s for s in sentences if 6<=len(s.split())<=24 and not re.search(r'\d|https?://',s)]
    return (choices[-1] if choices else ' '.join(plain.split()[:24])).strip()

def main():
    p=argparse.ArgumentParser(); p.add_argument('--as-of',default=dt.datetime.now(ZoneInfo('America/New_York')).date().isoformat());p.add_argument('--days',type=int,default=90);p.add_argument('--limit',type=int,default=180);p.add_argument('--pmids',default=''); a=p.parse_args()
    end=dt.date.fromisoformat(a.as_of); start=end-dt.timedelta(days=a.days)
    queries={
      'Lung':'(TITLE_ABS:"non-small cell lung" OR TITLE_ABS:"small cell lung")',
      'Breast':'TITLE_ABS:"breast cancer"', 'Pancreas':'TITLE_ABS:"pancreatic cancer"',
      'Liver':'TITLE_ABS:"hepatocellular carcinoma"', 'Gastric':'TITLE_ABS:"gastric cancer"',
      'Colorectal':'TITLE_ABS:"colorectal cancer"', 'Other':'TITLE_ABS:"melanoma"'}
    if a.pmids:
        if not all(x.isdigit() for x in a.pmids.split(',')): raise ValueError('PMIDs must be numeric')
        queries={'Lung':'('+' OR '.join('EXT_ID:'+x for x in a.pmids.split(','))+')'}
    path=ROOT/'data/acquisitions.json'; previous=json.loads(path.read_text()) if path.exists() else {'documents':[],'runs':[]}
    documents={x['id']+':'+x['version']:x for x in previous['documents']}; runs=previous['runs']
    for family,scope in queries.items():
        query=f'SRC:MED AND {scope} AND FIRST_PDATE:[{start} TO {end}] AND (TITLE_ABS:randomized OR TITLE_ABS:"phase 3" OR TITLE_ABS:"phase 2")'
        if a.pmids: query='SRC:MED AND '+scope
        run={'id':str(uuid.uuid4()),'connector':'europe-pmc.core.v1','family':family,'query':query,'started_at':dt.datetime.now(dt.timezone.utc).isoformat(),'window_start':None if a.pmids else str(start),'window_end':str(end),'mode':'pivotal-context' if a.pmids else 'recent-window'}
        try:
            records,hits,cursor=search(query,a.limit if family=='Lung' else 30)
            for r in records:
                passage=excerpt(r.get('abstractText',''))
                if not passage: continue
                # Original abstracts are processed in memory only; hash captures their version.
                source_hash=hashlib.sha256(text(r.get('abstractText','')).encode()).hexdigest()
                d={'id':'pmid:'+r['id'],'pmid':r['id'],'doi':r.get('doi'),'pmcid':r.get('pmcid'),
                   'title':text(r['title']),'source_name':r.get('journalInfo',{}).get('journal',{}).get('title','Unknown journal'),
                   'url':'https://pubmed.ncbi.nlm.nih.gov/'+r['id']+'/', 'original_url':('https://doi.org/'+r['doi']) if r.get('doi') else None,
                   'source_type':'journal','language':r.get('language'),'published_date':r.get('firstPublicationDate'),
                   'presentation_date':None,'registry_updated_at':None,'retrieved_at':run['started_at'],
                   'access':'metadata and limited abstract excerpt; no full text acquired','license':r.get('license') or 'not established; no full-text redistribution',
                   'source_hash':source_hash,'supporting_passage':passage,'location':'Abstract; exact limited excerpt',
                   'identifiers':{'doi':r.get('doi'),'pmid':r['id']},
                   'study_ids':sorted(set(re.findall(r'NCT\d{8}',text(r.get('abstractText',''))))),
                   'family_hint':family,'publication_types':r.get('pubTypeList',{}).get('pubType',[]),
                   'connector':'europe-pmc.core.v1','acquisition_run':run['id']}
                # Identity excludes retrieval time/run so retries do not create source versions.
                d['version']=digest({k:v for k,v in d.items() if k not in ('retrieved_at','acquisition_run')})
                documents.setdefault(d['id']+':'+d['version'],d)
            run.update(status='partial' if hits>len(records) else 'succeeded',hit_count=hits,fetched=len(records),cursor=cursor,truncated=hits>len(records),watermark=None if hits>len(records) else str(end))
        except Exception as e:
            run.update(status='quarantined',error_type=type(e).__name__,watermark=None)
        runs.append(run); print(family,run['status'],run.get('hit_count'),run.get('fetched'))
        path.write_text(json.dumps({'label':'LOCAL ACQUISITION STAGING; NOT A RELEASE','documents':list(documents.values()),'runs':runs},indent=2)+'\n')
        time.sleep(.5)
if __name__=='__main__': main()
