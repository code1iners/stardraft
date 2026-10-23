"""합의한 브리프에서 편집 가능한 HyperFrames 장면·음성·자막을 만든다."""
import json
import subprocess
from pathlib import Path
from html import escape

ROOT = Path(__file__).resolve().parents[1]
SCENES = [
 dict(id='question',start=0,duration=10,title='이 멘션, 코드에서 답을 찾으려면',lines=['동료가 비밀번호 재설정 링크의 유효 시간을 물었습니다.','스타드래프트에서 코드에 근거한 초안을 만들고, 직접 검토해 게시해 보겠습니다.']),
 dict(id='open',start=10,duration=8,title='메뉴 막대의 별에서 시작합니다',lines=['설치한 앱을 켜고, 맥 메뉴 막대의 별 아이콘을 누릅니다.','설정 열기에서 처음 필요한 세 가지를 연결합니다.']),
 dict(id='prepare',start=18,duration=8,title='준비할 것은 세 가지입니다',lines=['플로우 개인 에이피아이 키, 로그인된 로컬 에이전트, 그리고 코드 저장소가 필요합니다.','키 발급과 에이전트 설치는 미리 마쳐 주세요.']),
 dict(id='flow',start=26,duration=8,title='내 Flow 계정을 확인합니다',lines=['플로우 계정에 내 개인 키를 붙여 넣고, 확인을 누릅니다.','연결된 이름과 소속이 내 계정인지 확인하세요.']),
 dict(id='agent',start=34,duration=8,title='로그인된 Claude Code를 연결합니다',lines=['에이전트에서는 찾기, 버전, 로그인, 작동 확인이 진행됩니다.','작동 확인은 실제 사용량을 조금 씁니다. 코덱스도 선택할 수 있습니다.']),
 dict(id='folders',start=42,duration=8,title='저장소가 모인 작업 폴더를 고릅니다',lines=['저장소에서 폴더 추가를 누르고, 코드 저장소가 모인 상위 폴더를 고릅니다.','연결이 없는 멘션은 여기서 찾은 저장소를 바탕으로 처리합니다.']),
 dict(id='start',start=50,duration=10,title='이제 새 멘션을 기다립니다',lines=['필수 설정을 마쳤다면 감지 시작을 누릅니다.','이때부터 새 업무 멘션을 감지합니다. 과거 멘션을 자동으로 가져오지는 않습니다.']),
 dict(id='mention',start=60,duration=10,title='동료가 새 업무 멘션을 보냅니다',lines=['동료가 업무 댓글에서 나를 직접 지목해 질문합니다.','채팅이나 담당자 지정이 아닌, 나를 직접 지목한 새 업무 멘션이 대상입니다.']),
 dict(id='generation',start=70,duration=10,title='관련 저장소에서 초안을 만듭니다',lines=['연결된 저장소가 없으면 작업 폴더에서 적절한 저장소를 고릅니다.','로컬 에이전트가 관련 코드를 읽고, 멘션에 답할 초안을 만듭니다.']),
 dict(id='review',start=80,duration=10,title='초안이 나오면, 먼저 읽어 봅니다',lines=['알림이나 별 아이콘의 숫자로 초안이 준비된 것을 알 수 있습니다.','열린 화면에서 원문과 에이전트가 이해한 요구, 답변 초안을 비교합니다.']),
 dict(id='evidence',start=90,duration=12,title='근거 번호로 답의 출처를 확인합니다',lines=['초안 문장 옆의 근거 번호를 누르면, 설명과 파일 위치를 확인할 수 있습니다.','이 예제에서는 링크가 삼십 분 동안 유효하다는 코드 근거를 확인합니다.']),
 dict(id='edit',start=102,duration=12,title='내가 보낼 문장으로 다듬습니다',lines=['문장을 눌러 동료에게 보낼 표현으로 직접 수정하고, 받는 사람도 확인합니다.','편집하면 초안의 근거 번호는 숨겨집니다. 근거 확인을 먼저 마쳐 두세요.']),
 dict(id='post',start=114,duration=11,title='게시 전, 마지막으로 확인합니다',lines=['내용이 맞으면 게시를 누릅니다.','오 초 동안은 취소할 수 있습니다. 시간이 지나면 내 이름으로 플로우에 게시됩니다.']),
 dict(id='posted',start=125,duration=5,title='동료에게 내 답변이 도착합니다',lines=['게시되는 것은 답변 본문이며, 코드 근거는 포함되지 않습니다.']),
 dict(id='trial',start=130,duration=12,title='혼자라면, 최근 멘션으로 시험합니다',lines=['새 멘션을 기다리지 않고 연습하려면, 최근 멘션으로 시험을 누르세요.','실제 에이전트 사용량은 쓰지만 플로우에는 게시하지 않습니다. 시험 끝내기로 마칩니다.']),
 dict(id='finish',start=142,duration=8,title='근거를 확인하고, 내 답변으로 게시하세요',lines=['설정을 마치고, 근거를 확인하고, 내 답변으로 다듬어 게시하세요.','지금은 최근 멘션으로 시험부터 시작해 보세요.'])
]


def run(*args):
    """명령 인수는 셸을 거치지 않고 전달한다."""
    return subprocess.check_output(args,text=True).strip()


def duration(path):
    """캡션과 모션은 추측 대신 실제 음성 길이에 맞춘다."""
    return float(run('ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)))


def create_voice():
    """유료 호출 없이 macOS 한국어 음성으로 문장별 음원을 만든다."""
    for scene in SCENES:
        clips=[]
        for number,text in enumerate(scene['lines']):
            name=f"{scene['id']}-{number+1}"
            aiff=ROOT/'assets/audio'/f'{name}.aiff'
            wav=ROOT/'assets/audio'/f'{name}.wav'
            if not wav.exists():
                subprocess.run(['say','-v','Yuna','-r','205','-o',str(aiff),text],check=True)
                subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(aiff),'-ar','48000','-ac','1',str(wav)],check=True)
                aiff.unlink()
            clips.append(dict(id=name,text=text,path=f'assets/audio/{name}.wav',duration=duration(wav)))
        available=scene['duration']-0.9
        total=sum(c['duration'] for c in clips)+0.3*(len(clips)-1)
        # 한 장면의 슬롯을 넘는 음성만 시간 압축한다. 문장 간 숨은 남긴다.
        if total>available+0.06:
            factor=(total-0.3*(len(clips)-1))/(available-0.3*(len(clips)-1))
            for clip in clips:
                p=ROOT/clip['path']; temp=p.with_suffix('.tmp.wav')
                subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(p),'-af',f'atempo={factor:.5f}',str(temp)],check=True)
                temp.replace(p);clip['duration']=duration(p)
        cursor=0.5
        for clip in clips:
            clip['start']=round(scene['start']+cursor,3)
            cursor+=clip['duration']+0.3
        scene['voices']=clips
        print(scene['id'],round(cursor,2),'/',scene['duration'],flush=True)
    (ROOT/'source/scenes.json').write_text(json.dumps(SCENES,ensure_ascii=False,indent=2))


def image(name,top=0,width=1680,left=0,extra='',class_name=''):
    """앱 화면을 크게 확대하고 핵심 부분만 설명에 맞춰 보여준다."""
    return f'<div class="screen {class_name}" data-layout-allow-overflow><div class="screen-inner"><img class="app-image" src="assets/screens/{name}.png" style="width:{width}px;left:{left}px;top:{top}px" alt="가상 예제로 렌더링한 실제 Stardraft 화면"/>{extra}</div></div>'


def block(id,content,start,dur,cls=''):
    """편집기에서 선택할 수 있는 명시적 타임라인 요소."""
    return f'<div id="{id}" class="clip {cls}" data-start="{start}" data-duration="{dur}" data-track-index="2"><div class="beat-content">{content}</div></div>'


def cursor(id,x,y,start=2):
    """레지스트리 oversized-cursor의 화살표와 클릭 동작을 화면에 맞춰 적용한다."""
    return f'<div id="{id}" class="clip pointer-track" data-start="{start}" data-duration="2.2" data-track-index="5"><div class="pointer" style="left:{x}px;top:{y}px"><svg width="54" height="64" viewBox="0 0 24 24"><path d="M5 3 L5 19 L9 15 L12 22 L15 20.5 L11.5 14 L18 14 Z" fill="#1d2024" stroke="white" stroke-width="1.4"/></svg></div><div class="click-ring" style="left:{x+10}px;top:{y+10}px"></div></div>'


def content(scene):
    """장면별로 질문 한 건의 여정을 이어 붙인다."""
    id=scene['id']; d=scene['duration']; result=''; animation=''
    if id=='question':
        result='<div class="question-layout"><p class="sender">이지원 · 업무 댓글</p><p class="question"><span>@김민수</span> 비밀번호 재설정 링크의<br>유효 시간이 얼마인가요?</p><div class="answer-preview"><span class="answer-label">Stardraft의 초안</span><p>발급 후 <b>30분</b> 동안 사용할 수 있습니다.<sup>①</sup></p></div><p class="example">가상 업무·저장소 예제</p></div>'
        animation="tl.fromTo('.answer-preview',{y:40,opacity:0},{y:0,opacity:1,duration:0.65,ease:'power4.out'},4);"
    elif id=='open':
        result='<div class="menu-demo"><div class="menubar"><span>Stardraft</span><div class="menu-right"><img src="assets/tray.png"/>　금요일 오전 10:30</div></div><div class="menu-note">macOS 메뉴 막대 재현</div></div>'+block('open-welcome',image('welcome',top=-110,width=960,left=360),2.4,5.6)+cursor('open-click',1428,265,0.9)
        animation="tl.fromTo('#open-welcome .screen-inner',{y:-22,opacity:0},{y:0,opacity:1,duration:0.45,ease:'power4.out'},2.4);"
    elif id=='prepare':
        result='<div class="preparations"><div class="prep"><span class="prep-name">Flow 개인 API 키</span><span class="prep-detail">내 계정을 확인할 연결 키</span></div><div class="prep"><span class="prep-name">로그인된 에이전트</span><span class="prep-detail">이 PC의 Claude Code · Codex</span></div><div class="prep"><span class="prep-name">로컬 코드 저장소</span><span class="prep-detail">저장소가 모여 있는 작업 폴더</span></div></div>'
        animation="tl.fromTo('.prep',{x:42,opacity:0},{x:0,opacity:1,duration:0.5,stagger:1.65,ease:'power4.out'},0.6);"
    elif id=='flow':
        result=block('flow-input',image('flow-before',top=-45,width=2000,left=-340),0,3.8)+block('flow-connected',image('flow-after',top=-45,width=2000,left=-340),3.8,d-3.8)+cursor('flow-click',1249,655,2)
        animation="tl.fromTo('#flow-connected .screen-inner',{opacity:0},{opacity:1,duration:0.2},3.8);"
    elif id=='agent':
        result=''.join(block('agent-step-'+step,image('agent-'+step,top=-50,width=2000,left=-340),i*1.2,1.2) for i,step in enumerate(['find','version','login','run-check']))+block('agent-connected',image('agent',top=-50,width=2000,left=-340),4.8,d-4.8)+'<p class="note">에이전트 칸을 열면 자동으로 확인합니다. 연결 과정은 시간 압축했습니다.</p>'
        animation="tl.fromTo('.screen-inner',{y:15,opacity:0},{y:0,opacity:1,duration:0.45,ease:'power4.out'},0);"
    elif id=='folders':
        result=block('folder-empty',image('folders-before',top=-50,width=2000,left=-340),0,3.5)+block('folder-added',image('folders-after',top=-50,width=2000,left=-340),3.5,d-3.5)+cursor('folder-click',373,585,1.8)+block('folder-tree','<div class="folder-tree"><small>폴더 구조 예시 · 선택할 상위 폴더</small><strong>work / ← 이 폴더 선택</strong><span>└ account-api /</span></div>',2.6,3.5)
        animation="tl.fromTo('#folder-added .screen-inner',{opacity:0},{opacity:1,duration:0.2},3.5);"
    elif id=='start':
        result=block('start-ready',image('ready',top=-350,width=1120,left=280),0,4.6)+block('start-empty',image('empty',top=30,width=1120,left=280,extra='<p class="waiting-note">시작한 이후의 새 업무 멘션부터 감지합니다.</p>'),4.6,d-4.6)+cursor('start-click',1392,601,2.9)
        animation="tl.fromTo('#start-empty .screen-inner',{opacity:0},{opacity:1,duration:0.25},4.6);"
    elif id=='mention':
        result='<div class="flow-message"><div class="flow-heading">Flow 업무 댓글 · 재현 예시</div><div class="flow-author"><span class="avatar">지</span><div><b>이지원</b><small>계정 서비스 / 비밀번호 재설정 안내</small></div></div><p class="flow-text"><span>@김민수</span><br>비밀번호 재설정 링크의<br>유효 시간이 얼마인가요?</p><p class="example">감지 시작 이후에 들어온 새 업무 멘션</p></div>'
        animation="tl.fromTo('.flow-text',{x:45,opacity:0},{x:0,opacity:1,duration:0.6,ease:'power4.out'},1.2);"
    elif id=='generation':
        result=block('gen-map','<div class="connection"><div class="node"><small>로컬 저장소</small><strong>account-api</strong><span>재설정 링크 코드</span></div><div class="connector">→</div><div class="node"><small>이 PC의 에이전트</small><strong>Claude Code</strong><span>코드에 근거한 초안</span></div></div><p class="example map-note">예제에서는 작업 폴더에 저장소가 하나 있습니다. 생성 대기 시간은 압축했습니다.</p>',0,5.2)+block('gen-ui',image('generating',top=-70),5.2,d-5.2)
        animation="tl.fromTo('.connector',{scaleX:0},{scaleX:1,duration:0.6,ease:'power2.inOut'},1.2);tl.fromTo('#gen-ui .screen-inner',{x:80,opacity:0},{x:0,opacity:1,duration:0.5,ease:'power4.out'},5.2);"
    elif id=='review':
        result=image('review',top=-40)+ '<div class="notification"><img src="assets/tray.png"/><div><b>초안이 준비됐습니다</b><span>비밀번호 재설정 안내</span></div></div>'
        animation="tl.fromTo('.notification',{x:80,opacity:0},{x:0,opacity:1,duration:0.45,ease:'power4.out'},0);tl.to('.notification',{opacity:0,duration:0.2},3.1);tl.fromTo('.app-image',{y:0},{y:-490,duration:0.8,ease:'power2.inOut'},4.2);"
    elif id=='evidence':
        result=block('evidence-before',image('review',top=-650),0,3.0)+block('evidence-shown',image('evidence',top=-1080,width=2400,left=0,class_name='evidence-screen'),3.0,d-3.0)+cursor('evidence-click',938,483,1.4)+'<p class="note">①의 설명과 파일 위치를 확인합니다. 30분은 가상 코드 예제의 값입니다.</p>'
        animation="tl.fromTo('.evidence-screen .app-image',{y:70},{y:0,duration:0.65,ease:'power2.inOut'},3);tl.to('.evidence-screen .app-image',{y:-230,duration:0.8,ease:'power2.inOut'},6.2);"
    elif id=='edit':
        result=block('edit-original',image('review',top=-615),0,3.6)+block('edit-new',image('edited',top=-615),3.6,d-3.6)+cursor('edit-click',680,480,1.9)+'<p class="note">직접 편집하면 근거 번호가 숨겨집니다. 받는 사람도 확인하세요.</p>'
        animation="tl.fromTo('#edit-new .screen-inner',{opacity:0},{opacity:1,duration:0.2},3.6);"
    elif id=='post':
        result=image('edited',top=-850)+cursor('post-click',1713,779,1.35)
        for sec in range(5,0,-1):
            t=3.1+(5-sec)
            result+=block(f'count-{sec}',image('posting-'+str(sec),top=-850),t,1)
        result+=block('post-done','<div class="post-success"><span>✓</span> 게시 완료</div>',8.1,d-8.1)
        animation="tl.fromTo('.post-success',{scale:0.94,opacity:0},{scale:1,opacity:1,duration:0.45,ease:'power4.out'},8.1);"
    elif id=='posted':
        result='<div class="flow-message result-message"><div class="flow-heading">Flow 게시 결과 · 재현 예시</div><div class="flow-author"><span class="avatar mine">민</span><div><b>김민수</b><small>내 명의의 답변</small></div></div><p class="flow-text"><span>@이지원</span><br>재설정 링크는 발급 후 30분간 유효합니다.<br>시간이 지났다면 새 링크를 요청해 주세요.</p></div>'
        animation="tl.fromTo('.flow-text',{opacity:0},{opacity:1,duration:0.35},0.35);"
    elif id=='trial':
        result=block('trial-empty',image('empty',top=40,width=1120,left=280),0,4.5)+block('trial-ui',image('trial',top=-850),4.5,d-4.5)+cursor('trial-click',960,579,2.4)+'<p class="note">시험도 실제 에이전트 사용량을 씁니다. Flow에는 게시되지 않습니다.</p>'
        animation="tl.fromTo('#trial-ui .screen-inner',{opacity:0},{opacity:1,duration:0.25},4.5);"
    else:
        result='<div class="ending"><div class="end-actions"><span>근거 확인</span><i>→</i><span>문장 수정</span><i>→</i><span>게시</span></div><p class="end-trial">지금은 <b>최근 멘션으로 시험</b>부터</p><div class="credits">Music: “Wallpaper” — Kevin MacLeod (incompetech.com)<br>CC BY 4.0 · creativecommons.org/licenses/by/4.0/<br>Excerpted, lowered beneath narration, faded in/out</div></div>'
        animation="tl.fromTo('.end-actions span',{opacity:0},{opacity:1,duration:0.3,stagger:0.6},0.3);tl.fromTo('.end-trial',{y:24,opacity:0},{y:0,opacity:1,duration:0.5,ease:'power4.out'},2.5);"
    return result,animation


def ts(seconds):
    """SRT의 밀리초 단위 시각."""
    n=round(seconds*1000);return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'


def caption_text(text):
    """음성의 발음 표기는 자막에서 공식 제품명과 숫자로 되돌린다."""
    for before,after in [('스타드래프트','Stardraft'),('플로우','Flow'),('에이피아이','API'),('코덱스','Codex'),('삼십 분','30분'),('오 초','5초')]:
        text=text.replace(before,after)
    return text


def build():
    """장면과 루트·자막은 같은 타이밍 데이터에서 생성한다."""
    audio=[];hosts=[];captions=[];srt=[];story=['# 내레이션과 장면 구성\n']
    for s in SCENES:
        id=s['id'];d=s['duration'];body,animation=content(s)
        heading=f'<h1 data-var-text="{id}-title">{escape(s["title"])}</h1>'
        template=f'''<template><style>#root{{position:absolute;inset:0;}}</style><div id="root" data-composition-id="{id}" data-width="1920" data-height="1080"><div class="scene-background"></div><div class="scene-content">{heading}{body}</div></div><script>/** 이 장면의 결정적 모션 타임라인. */const tl=gsap.timeline({{paused:true}});tl.fromTo('.scene-content h1',{{opacity:0}},{{opacity:1,duration:0.22}},0);{animation}/** 클릭은 커서가 도착한 뒤 한 번만 발생한다. */document.querySelectorAll('.pointer-track').forEach((el)=>{{const at=Number(el.dataset.start);tl.fromTo(el.querySelector('.pointer'),{{x:95,y:75,opacity:0}},{{x:0,y:0,opacity:1,duration:0.65,ease:'power2.inOut'}},at);tl.fromTo(el.querySelector('.click-ring'),{{scale:0.35,opacity:0.8}},{{scale:1.5,opacity:0,duration:0.45,ease:'power2.out'}},at+0.75);}});window.__timelines['{id}']=tl;</script></template>'''
        (ROOT/f'compositions/{id}.html').write_text(template)
        hosts.append(f'<div id="{id}" class="clip" data-composition-id="{id}" data-composition-src="compositions/{id}.html" data-start="{s["start"]}" data-duration="{d}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
        story.append(f'## {s["start"]}–{s["start"]+d}초 · {s["title"]}\n')
        for v in s['voices']:
            begin=v['start'];end=min(begin+v['duration']+0.1,s['start']+d-0.08)
            audio.append(f'<audio id="voice-{v["id"]}" class="clip" src="{v["path"]}" data-start="{begin}" data-duration="{v["duration"]}" data-track-index="10" data-volume="1"></audio>')
            captions.append(block('caption-'+v['id'],f'<p>{escape(caption_text(v['text']))}</p>',begin,round(end-begin,3),'caption'))
            srt.append(f'{len(srt)+1}\n{ts(begin)} --> {ts(end)}\n{caption_text(v["text"])}\n')
            story.append(v['text']+'\n')
    cap='<template><style>#root{position:absolute;inset:0;pointer-events:none;}</style><div id="root" data-composition-id="captions" data-width="1920" data-height="1080">'+''.join(captions)+'</div><script>/** 字幕の表示窓は明示的なclipが管理する。 */window.__timelines.captions=gsap.timeline({paused:true});</script></template>'
    cap=cap.replace('/** 字幕の表示窓は明示的なclipが管理する。 */','/** 자막 표시 구간은 명시적인 clip 속성으로 관리한다. */')
    (ROOT/'compositions/captions.html').write_text(cap)
    hosts.append('<div id="captions" class="clip" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="150" data-track-index="20" data-track-kind="captions" data-width="1920" data-height="1080" style="z-index:20"></div>')
    # 효과음은 보이는 클릭과 완료 신호에만 배치한다.
    for n,t in enumerate([12.65,28.75,44.55,53.65,92.15,104.65,116.1,133.15]):
        audio.append(f'<audio id="click-{n}" class="clip" src=".media/audio/sfx/sfx_001.mp3" data-start="{t}" data-duration="0.37" data-track-index="12" data-volume="0.28"></audio>')
    audio.append('<audio id="notification" class="clip" src=".media/audio/sfx/sfx_002.mp3" data-start="80.03" data-duration="2.5" data-track-index="12" data-volume="0.16"></audio>')
    audio.append('<audio id="music" class="clip" src="assets/audio/wallpaper-bed.wav" data-start="0" data-duration="150" data-track-index="11" data-volume="0.14" data-fade-in="1.2" data-fade-out="3"></audio>')
    variables=[dict(id=s['id']+'-title',type='string',label=s['title'],default=s['title']) for s in SCENES]+[dict(id='accent',type='color',label='앱 강조색',default='#2160c4')]
    html=f'''<!doctype html><html lang="ko" data-composition-variables='{json.dumps(variables,ensure_ascii=False)}'><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><link rel="stylesheet" href="assets/style.css"><script src="assets/vendor/gsap.min.js"></script></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="150" data-width="1920" data-height="1080" data-fps="30">{''.join(hosts)}{''.join(audio)}</div><script>/** 하위 장면은 HyperFrames 런타임이 개별적으로 탐색한다. */window.__timelines=window.__timelines||{{}};window.__timelines.main=gsap.timeline({{paused:true}});</script></body></html>'''
    (ROOT/'index.html').write_text(html)
    (ROOT/'stardraft-tutorial.ko.srt').write_text('\n'.join(srt))
    (ROOT/'STORYBOARD.md').write_text('\n'.join(story))
    print('built 16 scenes, '+str(len(srt))+' narration/caption segments',flush=True)

if __name__=='__main__':
    create_voice();build()
