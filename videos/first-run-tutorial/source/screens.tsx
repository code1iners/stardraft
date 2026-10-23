import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { PopoverContent } from '../../../apps/desktop/src/renderer/src/PopoverView';
import { SetupBand } from '../../../apps/desktop/src/renderer/src/Onboarding';
import { FlowAccountSection } from '../../../apps/desktop/src/renderer/src/FlowAccountSection';
import { AgentSection } from '../../../apps/desktop/src/renderer/src/AgentSection';
import { RepositoriesSection } from '../../../apps/desktop/src/renderer/src/RepositoriesSection';
import { BundleMeta, BundleSections, BundleFooter } from '../../../apps/desktop/src/renderer/src/BundleDetail';
import { TrialPickerSheet } from '../../../apps/desktop/src/renderer/src/TrialPicker';

/** 촬영 중 시간과 데이터는 고정된 가상 예제만 사용한다. */
const time = Date.UTC(2026, 9, 23, 1, 30);
Date.now = () => time;
/** 화면 동작을 실행하지 않는 렌더링용 콜백. */
const noop = () => {};
/** 실제 앱에 전달하는 형식의 가상 상태. 외부 서비스와 연결하지 않는다. */
const snapshot: any = {
  appName: 'Stardraft', version: '0.1.0', platform: 'darwin',
  flowAccount: {account: null, keyCheck:{status:'idle'}}, globalProblem:null,
  agentConnections:[{agent:'claude-code', progress:{status:'connected'},cliFound:true, details:{cliPath:'/usr/local/bin/claude',cliCommand:'claude',updateCommand:'claude update',version:'2.1.0',requiredVersion:'2.0.0',authMethod:'claude.ai',pathSource:'path',searchedDirs:[],errorOutput:null}}],
  agentPreferences:{connectedAgents:['claude-code'],defaultAgent:'claude-code',models:{}},
  workFolders:{folders:[],suggestions:[],rejected:[]},repoMappings:{mappings:[],projects:{status:'idle'}},
  onboarding:{detectionStarted:false,requirements:{'flow-key':'needed',agent:'needed','work-folders':'needed'},ready:false,start:{status:'idle'}},
  launchAtLogin:false,editor:{choice:null,installed:[],picker:null},
  review:{bundles:[],sections:{compact:{original:true,requirement:true,draft:true,evidence:false,repository:false,progress:true},expanded:{original:true,requirement:true,draft:true,evidence:true,repository:true,progress:true}},repoPicker:null},
  trial:{canStart:true,bundleId:null,picker:null},draftSettings:{extraInstructions:'',defaultSecretPatterns:['.env'],extraSecretPatterns:[]},
  update:{status:{kind:'idle'},justUpdated:null,restartConfirm:null,dismissedBanners:[]}
};
/** 질문과 답변은 같은 가상 코드 예제를 참조한다. */
const question = '비밀번호 재설정 링크의 유효 시간이 얼마인가요?';
/** 근거가 연결된 원래 초안. */
const draft:any = {requirement:{text:'비밀번호 재설정 링크가 언제 만료되는지 확인합니다.',summary:'비밀번호 재설정 링크 유효 시간'},paragraphs:[{sentences:[{text:'비밀번호 재설정 링크는 발급 후 30분 동안 사용할 수 있습니다.',evidence:[1],developerTerms:[]}]}],evidence:[{id:1,explanation:'재설정 링크의 유효 시간을 30분으로 설정합니다.',repositoryName:'account-api',path:'src/auth/reset-token.ts',startLine:12,endLine:12,located:true,developerTerms:[]}],repositories:[{name:'account-api',path:'/Users/demo/work/account-api'}],autoSelection:{kind:'single-candidate'},mapping:'unmapped',editorText:'비밀번호 재설정 링크는 발급 후 30분 동안 사용할 수 있습니다.',edited:false,canEdit:true,canRegenerate:true,recipients:[{name:'이지원'}],postBodyPrefixLength:5,canPost:true};
/** 새 업무 멘션 하나. */
const bundle:any={id:1,status:'ready',group:'awaiting-review',place:'thread',projectTitle:'계정 서비스',postTitle:'비밀번호 재설정 안내',mentions:[{senderName:'이지원',place:'comment',at:time,text:[{text:'@김민수',mention:true},{text:' '+question,mention:false}],edited:false}],senderNames:['이지원'],newMentionCount:0,directives:[],lastMentionAt:time,processedAt:null,canRestore:false,canOpenInFlow:true,thread:[],draft,run:{agent:'claude-code',durationMs:18000,contextOmitted:false},generation:null,failure:null,repoCheck:null,posting:null,postFailure:null,quitDuringCountdown:false,changes:{newWritingCount:0,edited:false,goneMentionCount:0},trial:false};
/** 원래 앱의 스타일. 생성된 PNG만 영상에서 사용하므로 앱 코드에는 변경이 없다. */
const css=readFileSync('../../apps/desktop/src/renderer/src/styles.css','utf8');
/** 가상 상태에서 렌더링한 화면과 크기. */
const screens:any[]=[];
/** 실제 React 컴포넌트를 독립 문서로 저장한다. */
function save(name:string, element:React.ReactNode, width:number, height:number){
  const html='<!doctype html><html lang="ko"><meta charset="utf-8"><style>'+css+'\n@font-face{font-family:DemoKR;src:url(../assets/fonts/NotoSansKR.ttf)}:root{--font:DemoKR,sans-serif}body{background:white}#root{height:100%}.detail-body{overflow:hidden} .popover{height:100%}</style><body><div id="root">'+renderToStaticMarkup(element)+'</div></body></html>';
  writeFileSync('source/'+name+'.html',html);screens.push({name,width,height});
}
/** 실제 설정 창의 레이아웃을 공유하고 내용 컴포넌트만 바꾼다. */
function settings(section:string,title:string,content:React.ReactNode){return <div className="settings-window"><SetupBand snapshot={snapshot} section={section as any} onSelectSection={noop}/><div className="settings"><nav className="settings-nav">{[['flow-account','Flow 계정'],['agent','에이전트'],['repositories','저장소'],['drafts','초안'],['general','일반']].map(([id,label])=><button key={id} className="settings-nav-item" aria-current={section===id?'page':undefined}>{label}</button>)}</nav><main className="settings-main"><h2>{title}</h2>{content}</main></div></div>}
/** 검토 화면은 앱의 본문과 하단 행동을 그대로 렌더링한다. */
function review(value:any,evidence=false){
  const sections=structuredClone(snapshot.review.sections);sections.expanded.repository=false;sections.expanded.evidence=evidence;
  return <div className="popover"><header className="popover-head"><strong>Stardraft</strong><span className="spacer"/>1 / 1</header><main className="popover-body review-body"><BundleMeta bundle={value}/><BundleSections bundle={value} windowKind="expanded" sections={sections} movedWhileViewing={false}/></main><BundleFooter bundle={value} onIgnore={noop} onRestore={noop} onCancel={noop} onRetry={noop} onPost={noop} onCancelPost={noop} onEndTrial={noop}/></div>
}
save('welcome',<PopoverContent snapshot={snapshot}/>,480,430);
save('flow-before',settings('flow-account','Flow 계정',<FlowAccountSection flowAccount={snapshot.flowAccount} keyNeedsCheck={false}/>),840,530);
snapshot.flowAccount.account={name:'김민수',division:'개발팀',email:'minsu@example.test'};snapshot.onboarding.requirements['flow-key']='done';
save('flow-after',settings('flow-account','Flow 계정',<FlowAccountSection flowAccount={snapshot.flowAccount} keyNeedsCheck={false}/>),840,530);
save('agent',settings('agent','에이전트',<AgentSection agentConnections={snapshot.agentConnections} agentPreferences={snapshot.agentPreferences} platform="darwin"/>),840,530);
for (const step of ['find','version','login','run-check']) {
  const checking=snapshot.agentConnections.map((value:any)=>({...value,progress:{status:'checking',step}}));
  save('agent-'+step,settings('agent','에이전트',<AgentSection agentConnections={checking} agentPreferences={{connectedAgents:[],defaultAgent:null,models:{}}} platform="darwin"/>),840,530);
}
snapshot.onboarding.requirements.agent='done';
save('folders-before',settings('repositories','저장소',<RepositoriesSection workFolders={snapshot.workFolders} repoMappings={snapshot.repoMappings}/>),840,560);
snapshot.workFolders.folders=[{path:'/Users/demo/work',scan:{status:'found',repos:[{name:'account-api',path:'/Users/demo/work/account-api',kind:'git'}]}}];
snapshot.onboarding.requirements['work-folders']='done';snapshot.onboarding.ready=true;
save('folders-after',settings('repositories','저장소',<RepositoriesSection workFolders={snapshot.workFolders} repoMappings={snapshot.repoMappings}/>),840,560);
save('ready',<PopoverContent snapshot={snapshot}/>,480,470);
snapshot.onboarding.detectionStarted=true;
save('empty',<PopoverContent snapshot={snapshot}/>,480,300);
save('generating',review({...bundle,status:'generating',draft:null,generation:{status:'running',step:'코드를 읽어 답변을 정리하고 있습니다',filesRead:3}}),760,540);
save('review',review(bundle),760,650);
save('evidence',review(bundle,true),760,730);
save('edited',review({...bundle,draft:{...draft,editorText:'재설정 링크는 발급 후 30분간 유효합니다. 시간이 지났다면 새 링크를 요청해 주세요.',edited:true}}),760,650);
save('trial',review({...bundle,trial:true}),760,650);
for (const seconds of [5,4,3,2,1]) save('posting-'+seconds,review({...bundle,status:'posting',posting:{phase:'countdown',endsAt:time+seconds*1000},draft:{...draft,editorText:'재설정 링크는 발급 후 30분간 유효합니다. 시간이 지났다면 새 링크를 요청해 주세요.',edited:true,canEdit:false,canRegenerate:false,canPost:false}}),760,650);
writeFileSync('source/screens.json',JSON.stringify(screens,null,2));
