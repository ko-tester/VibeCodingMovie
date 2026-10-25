// F1 and live F2 data are loaded through the local server API. Demo fixtures stay local.
const films = [
  {rank:"1",title:"달빛 항해",release:"2026.08.20",revenue:"1834200000",audience:"184206",totalAudience:"13126474",genre:"드라마",tag:"달"},
  {rank:"2",title:"바다의 노래",release:"2026.08.28",revenue:"1248600000",audience:"128384",totalAudience:"11916851",genre:"미스터리",tag:"바"},
  {rank:"3",title:"도시의 밤",release:"2026.08.12",revenue:"972300000",audience:"101652",totalAudience:"11506724",genre:"액션",tag:"밤"},
  {rank:"4",title:"여름의 지도",release:"2026.07.30",revenue:"621540000",audience:"63512",totalAudience:"8793210",genre:"애니메이션",tag:"여"},
  {rank:"5",title:"마지막 편지",release:"2026.08.02",revenue:"386210000",audience:"40284",totalAudience:"7521084",genre:"드라마",tag:"편"},
  {rank:"6",title:"작은 행성",release:"2026.08.10",revenue:"218760000",audience:"22614",totalAudience:"5128491",genre:"SF",tag:"행"},
  {rank:"7",title:"바람의 노래",release:"2026.07.14",revenue:"187430000",audience:"19402",totalAudience:"2210468",genre:"판타지",tag:"바"},
  {rank:"8",title:"오후 네 시",release:"2026.06.23",revenue:"125800000",audience:"13178",totalAudience:"3531186",genre:"로맨스",tag:"4"},
  {rank:"9",title:"파일럿",release:"2026.07.31",revenue:"96350000",audience:"10031",totalAudience:"4718269",genre:"코미디",tag:"P"},
  {rank:"10",title:"탈주의 끝",release:"2026.07.03",revenue:"74820000",audience:"7906",totalAudience:"2561995",genre:"액션",tag:"탈"},
];
const $ = (id) => document.getElementById(id);
const paramsOnLoad = new URLSearchParams(window.location.search);
const state = {period:"daily",scenario:"auto",mode:"unknown",range:7,toastTimer:null,controller:null,requestId:0,insightController:null,insightRetryControllers:new Map(),insightRequestId:0,insightEntries:[],insightKey:null};
const fmt = new Intl.NumberFormat("ko-KR");
const won = (value) => `₩ ${fmt.format(value)}`;
const num = (value) => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("잘못된 샘플 수치입니다.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("안전한 숫자 범위를 벗어난 샘플 수치입니다.");
  return parsed;
};
function dateLabel(value) { if(!value) return "날짜 미선택"; const [y,m,d] = value.split("-"); return `${y}년 ${Number(m)}월 ${Number(d)}일`; }
function toast(message) {
  const el = $("toast"); el.textContent = message; el.hidden = false;
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}
function toInteger(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("서버에서 받은 수치가 올바르지 않습니다.");
  return value;
}
function summary(items) {
  const revenue = items.reduce((sum, film) => sum + toInteger(film.revenue), 0);
  const audience = items.reduce((sum, film) => sum + toInteger(film.audience), 0);
  $("sumRevenue").textContent = won(revenue);
  $("sumAudience").textContent = `${fmt.format(audience)}명`;
  $("sumMovies").textContent = `${items.length}편`;
  $("sumLeader").textContent = items[0]?.title ?? "—";
}
function rankClass(rank) { return ({1:"gold",2:"silver",3:"bronze"})[Number(rank)] ?? ""; }
function ensureTable() {
  if ($("filmRows")) return;
  $("resultsRegion").innerHTML = '<div class="table-scroll"><table><thead><tr><th class="rank-col">순위</th><th>영화명</th><th>개봉일</th><th class="numeric">매출액</th><th class="numeric">관객수</th><th class="numeric">누적 관객수</th><th></th></tr></thead><tbody id="filmRows"></tbody></table></div>';
}
function makeCell(content, className="") {
  const cell = document.createElement("td"); if (className) cell.className=className; cell.textContent=content; return cell;
}
function renderTable(items) {
  ensureTable();
  const rows = $("filmRows"); rows.replaceChildren();
  for (const film of items) {
    const tr = document.createElement("tr");
    const rankCell=document.createElement("td"); const badge=document.createElement("span"); badge.className=`rank-badge ${rankClass(film.rank)}`; badge.textContent=String(film.rank); rankCell.append(badge); tr.append(rankCell);
    const movieCell=document.createElement("td"); const movie=document.createElement("div"); movie.className="movie-cell";
    const poster=document.createElement("div"); poster.className=`poster p${film.rank}`; poster.textContent=film.tag || film.title.slice(0,1);
    const description=document.createElement("div"); const name=document.createElement("div"); name.className="movie-name"; name.textContent=film.title;
    const genre=document.createElement("div"); genre.className="movie-meta"; genre.textContent=film.genre || ""; description.append(name,genre); movie.append(poster,description); movieCell.append(movie); tr.append(movieCell);
    tr.append(makeCell(film.releaseDate || "—"),makeCell(won(toInteger(film.revenue)),"numeric revenue"),makeCell(`${fmt.format(toInteger(film.audience))}명`,"numeric"),makeCell(`${fmt.format(toInteger(film.totalAudience))}명`,"numeric"),makeCell(""));
    rows.append(tr);
  }
  $("resultCount").textContent = `${items.length}개 영화`;
  $("footerCount").textContent = `전체 ${items.length}편`;
  $("resultCaption").textContent = `${dateLabel($("dateInput").value)} 기준 · ${({daily:"일간",weekly:"주간",weekend:"주말"})[state.period]}`;
}
function updateDatasetMeta({count="—",source=null,collectedAt="—",warning=null}={}) {
  $("datasetCount").textContent = typeof count === "number" ? `${count}건` : count;
  $("datasetSource").textContent = source || (state.mode==="live"?"KOBIS Open API":"KOBIS 샘플 데이터");
  $("datasetCollected").textContent = collectedAt === "—" ? collectedAt : new Date(collectedAt).toLocaleString("ko-KR",{dateStyle:"short",timeStyle:"short"});
  const warningElement=$("cacheWarning"); warningElement.hidden=!warning?.message; warningElement.textContent=warning?.message||"";
}
function emptyPanel(kind, query="", message="") {
  const region = $("resultsRegion");
  const titles={loading:"박스오피스 데이터를 불러오는 중입니다",empty:"선택한 조회 기간에는 데이터가 없습니다",search:"검색 결과가 없습니다",error:"박스오피스 데이터를 불러오지 못했습니다"};
  const copies={
    loading:"잠시만 기다려 주세요.",
    empty:"조회는 정상적으로 완료됐지만 해당 기간의 박스오피스 기록이 없습니다. 오류가 아닙니다. 다른 날짜나 기간 유형을 선택해 보세요.",
    search:`“${query}”와 일치하는 영화가 없습니다. 조회 데이터는 정상적으로 불러왔습니다. 검색어를 지우거나 다른 제목을 입력해 보세요.`,
    error:message || "연결 상태를 확인한 뒤 다시 시도해 주세요."
  };
  const icon=kind==="loading"?"◌":kind==="error"?"!":kind==="empty"?"▤":"⌕";
  const panel=document.createElement("div"); panel.className=`empty-state ${kind==="error"?"error-state":""} ${kind==="loading"?"loading-state":""}`;
  const content=document.createElement("div"); const symbol=document.createElement("div"); symbol.className=`empty-icon ${kind==="loading"?"demo-spinner":""}`; symbol.textContent=icon;
  const heading=document.createElement("h3"); heading.textContent=titles[kind]; const description=document.createElement("p"); description.textContent=copies[kind];
  content.append(symbol,heading,description);
  if(kind==="error"||kind==="empty"||kind==="search") {
    const action=document.createElement("button"); action.type="button";
    if(kind==="error") { action.textContent="다시 시도"; action.onclick=()=>{state.scenario="auto"; $("scenarioSelect").value="auto"; syncUrl(); void runQuery();}; }
    else if(kind==="search") { action.textContent="검색어 지우기"; action.onclick=()=>{$("searchInput").value=""; $("clearSearch").hidden=true; syncUrl(); void runQuery();}; }
    else { action.textContent="다른 날짜 선택"; action.onclick=()=>{$("dateInput").value="2026-09-05"; state.scenario="auto"; $("scenarioSelect").value="auto"; syncUrl(); void runQuery();}; }
    content.append(action);
  }
  panel.append(content); region.replaceChildren(panel);
}
function syncUrl() {
  const params=new URLSearchParams();
  params.set("date",$("dateInput").value); params.set("period",state.period);
  const query=$("searchInput").value.trim(); if(query) params.set("q",query);
  if(state.scenario!=="auto") params.set("state",state.scenario);
  history.replaceState({},"",`${location.pathname}?${params.toString()}`);
}
async function runQuery() {
  const requestId=++state.requestId;
  if(state.controller) state.controller.abort();
  const query=$("searchInput").value.trim();
  $("periodTitle").textContent=`${({daily:"일간",weekly:"주간",weekend:"주말"})[state.period]} 박스오피스`;
  $("resultCaption").textContent=`${dateLabel($("dateInput").value)} 기준 · ${({daily:"일간",weekly:"주간",weekend:"주말"})[state.period]}`;
  if(state.scenario==="loading"&&state.mode==="demo") {
    summary([]); updateDatasetMeta({count:"조회 중",collectedAt:"—"});
    $("resultCount").textContent="조회 중"; $("footerCount").textContent="응답 대기 중"; emptyPanel("loading"); return;
  }
  state.controller=new AbortController();
  summary([]); updateDatasetMeta({count:"조회 중",collectedAt:"—"});
  $("resultCount").textContent="조회 중"; $("footerCount").textContent="응답 대기 중"; emptyPanel("loading");
  const queryParams=new URLSearchParams({date:$("dateInput").value,period:state.period});
  if(query) queryParams.set("q",query);
  if(state.mode==="demo"&&(state.scenario==="empty"||state.scenario==="error")) queryParams.set("state",state.scenario);
  try {
    const response=await fetch(`/api/boxoffice?${queryParams.toString()}`,{signal:state.controller.signal,cache:"no-store"});
    const payload=await response.json();
    if(requestId!==state.requestId) return;
    if(!response.ok) { const error=new Error(payload.error?.message||"조회에 실패했습니다."); error.code=payload.error?.code; error.warning=payload.meta?.warning; throw error; }
    if(!Array.isArray(payload.data?.movies)||typeof payload.meta?.total!="number") throw new Error("서버 응답 형식이 올바르지 않습니다.");
    if(payload.meta?.mode) state.mode=payload.meta.mode;
    const movies=payload.data.movies;
    updateDatasetMeta({count:payload.meta.total,source:payload.meta.source,collectedAt:payload.meta.collectedAt,warning:payload.meta.warning});
    if(payload.meta.totalBeforeSearch===0) {
      summary([]); $("resultCount").textContent="0개 영화"; $("footerCount").textContent="전체 0편"; emptyPanel("empty"); return;
    }
    if(movies.length===0&&query) {
      summary([]); $("resultCount").textContent="검색 결과 0건"; $("footerCount").textContent="검색 결과 0편"; emptyPanel("search",query); return;
    }
    summary(movies); renderTable(movies);
  } catch(error) {
    if(error.name==="AbortError"||requestId!==state.requestId) return;
    updateDatasetMeta({count:"—",collectedAt:"—",warning:error.warning});
    summary([]); $("resultCount").textContent="조회 실패"; $("footerCount").textContent="결과를 표시할 수 없음";
    emptyPanel("error","",error.message);
  }
}
function setInsightStatus(message="",kind="") {
  const status=$("insightStatus");
  status.hidden=!message;
  status.textContent=message;
  status.dataset.kind=kind;
}
function insightDates(endDate,days) {
  const end=new Date(`${endDate}T00:00:00Z`);
  return Array.from({length:days},(_,index)=>{
    const day=new Date(end); day.setUTCDate(end.getUTCDate()-days+1+index);
    return day.toISOString().slice(0,10);
  });
}
function svgNode(name,attributes={}) {
  const element=document.createElementNS("http://www.w3.org/2000/svg",name);
  for(const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
  return element;
}
function amountInUnit(value,divisor,unit) {
  const tenths=(value*10n+divisor/2n)/divisor;
  return `${fmt.format(Number(tenths)/10)} ${unit}`;
}
function revenueLabel(value) { return amountInUnit(value,100000000n,"억원"); }
function audienceLabel(value) { return amountInUnit(value,1000n,"천명"); }
function entryCounts() {
  const counts={normal:0,empty:0,failed:0,loading:0,pending:0};
  for(const entry of state.insightEntries) counts[entry.status]=(counts[entry.status]||0)+1;
  return counts;
}
function renderInsightProgress(currentDate=null) {
  const entries=state.insightEntries; const counts=entryCounts();
  const done=counts.normal+counts.empty+counts.failed;
  const total=entries.length||state.range;
  $("insightProgress").max=total; $("insightProgress").value=done;
  $("progressValue").textContent=`${done} / ${total}일`;
  $("progressLabel").textContent=currentDate?`조회 중 · ${currentDate}`:done===total&&counts.failed===0&&counts.empty===0?"모든 날짜 정상 조회 완료":done===total?"조회 완료 · 확인이 필요한 날짜가 있습니다":"조회 대기";
  $("countNormal").textContent=counts.normal; $("countEmpty").textContent=counts.empty;
  $("countFailed").textContent=counts.failed; $("countLoading").textContent=counts.loading;
  $("countPending").textContent=counts.pending;
  const list=$("insightDays"); list.replaceChildren();
  for(const entry of entries) {
    const item=document.createElement("li"); item.className=`day-status-item status-${entry.status}`;
    const date=document.createElement("time"); date.dateTime=entry.date; date.textContent=entry.date;
    const status=document.createElement("span"); status.className="day-status-label";
    status.textContent=({normal:"정상",empty:"빈 날짜",failed:"실패",loading:"조회 중",pending:"대기"})[entry.status];
    item.append(date,status);
    if(entry.error){const error=document.createElement("small");error.textContent=entry.error;item.append(error);}
    if(entry.status==="failed") {const retry=document.createElement("button");retry.type="button";retry.className="day-retry";retry.dataset.retryDate=entry.date;retry.textContent="이 날짜만 다시 조회";item.append(retry);}
    list.append(item);
  }
}
function makeLineChart() {
  const svg=$("revenueChart"); svg.replaceChildren();
  const width=760,height=250,left=62,right=18,top=18,bottom=24;
  const plotWidth=width-left-right,plotHeight=height-top-bottom;
  const entries=state.insightEntries;
  const points=entries.map((entry,index)=>({entry,index,value:entry.status==="normal"?entry.revenue:null}));
  const values=points.filter(point=>point.value!==null).map(point=>Number(point.value)/100000000);
  const max=Math.max(1,...values);
  for(let tick=0;tick<=2;tick++) {
    const y=top+plotHeight*tick/2;
    svg.append(svgNode("line",{x1:left,y1:y,x2:width-right,y2:y,class:"chart-gridline"}));
    const label=svgNode("text",{x:left-9,y:y+4,"text-anchor":"end",class:"chart-axis-label"});
    label.textContent=`${(max*(2-tick)/2).toFixed(1)}억`; svg.append(label);
  }
  const xFor=index=>entries.length<=1?left+plotWidth/2:left+plotWidth*index/(entries.length-1);
  const yFor=value=>top+plotHeight*(1-(Number(value)/100000000)/max);
  let segment=[];
  const flush=()=>{
    if(segment.length>1) svg.append(svgNode("path",{d:segment.map((point,index)=>`${index?"L":"M"}${point.x},${point.y}`).join(" "),class:"revenue-line"}));
    segment=[];
  };
  for(const point of points) {
    if(point.value===null){flush();continue;}
    const x=xFor(point.index),y=yFor(point.value); segment.push({x,y});
    const circle=svgNode("circle",{cx:x,cy:y,r:4,class:"revenue-point"});
    const title=svgNode("title");title.textContent=`${point.entry.date} · ${revenueLabel(point.value)}`;circle.append(title);svg.append(circle);
  }
  flush();
  const labels=$("chartLabels"); labels.replaceChildren();
  const tickCount=Math.min(7,entries.length);
  for(let index=0;index<tickCount;index++) {
    const dataIndex=tickCount===1?0:Math.round(index*(entries.length-1)/(tickCount-1));
    const label=document.createElement("span");label.textContent=entries[dataIndex].date.slice(5);labels.append(label);
  }
  if(values.length===0) {
    const label=svgNode("text",{x:width/2,y:height/2,"text-anchor":"middle",class:"chart-empty-label"});
    label.textContent="표시할 정상 관측 날짜가 없습니다";svg.append(label);
  }
}
function drawTopMovieChart(available) {
  const chart=$("topMoviesChart"),placeholder=$("topMoviesPlaceholder"); chart.replaceChildren();
  placeholder.hidden=available;
  if(!available) return;
  const totals=new Map();
  for(const entry of state.insightEntries) for(const movie of entry.movies) {
    const movieCode=String(movie.movieCode);
    const current=totals.get(movieCode)||{movieCode,title:movie.title,revenue:0n};
    current.revenue+=BigInt(toInteger(movie.revenue));
    if(movie.title) current.title=movie.title;
    totals.set(movieCode,current);
  }
  const ranked=[...totals.values()].sort((a,b)=>a.revenue===b.revenue?a.title.localeCompare(b.title,"ko"):a.revenue>b.revenue?-1:1).slice(0,5);
  const max=ranked[0]?.revenue||1n;
  ranked.forEach((movie,index)=>{
    const row=document.createElement("div");row.className="top-movie-row";
    const label=document.createElement("div");label.className="top-movie-label";
    const rank=document.createElement("span");rank.className=`top-movie-rank rank-${index+1}`;rank.textContent=String(index+1);
    const name=document.createElement("span");name.textContent=movie.title;name.title=`${movie.title} · ${movie.movieCode}`;
    const value=document.createElement("strong");value.textContent=revenueLabel(movie.revenue);
    label.append(rank,name,value);
    const track=document.createElement("div");track.className="top-movie-track";
    const bar=document.createElement("div");bar.className="top-movie-fill";bar.style.width=`${Number(movie.revenue*10000n/max)/100}%`;track.append(bar);
    row.append(label,track);chart.append(row);
  });
}
function drawInsightData() {
  makeLineChart();
  const allNormal=state.insightEntries.length===state.range&&state.insightEntries.every(entry=>entry.status==="normal");
  drawTopMovieChart(allNormal);
  const metricsPlaceholder=$("metricPlaceholder"); metricsPlaceholder.hidden=allNormal;
  if(!allNormal) {
    $("periodAudience").textContent="—";$("revenuePerAudience").textContent="—";
    metricsPlaceholder.textContent="빈 날짜·실패·조회 중인 날짜가 있습니다. 기간 합계와 Top 5는 모든 날짜에 정상 결과가 있을 때 표시합니다.";
    return;
  }
  let totalRevenue=0n,totalAudience=0n;
  for(const entry of state.insightEntries) for(const movie of entry.movies) {
    totalRevenue+=BigInt(toInteger(movie.revenue));
    totalAudience+=BigInt(toInteger(movie.audience));
  }
  $("periodAudience").textContent=audienceLabel(totalAudience);
  $("revenuePerAudience").textContent=totalAudience>0n?`₩ ${fmt.format(Number((totalRevenue+totalAudience/2n)/totalAudience))} /명`:"—";
  metricsPlaceholder.textContent="기간 전체 합계: 일별 Top 10에 관측된 매출·관객만 포함합니다.";
}
function updateInsightStatus() {
  const counts=entryCounts();
  if(counts.pending||counts.loading) {
    const current=state.insightEntries.find(entry=>entry.status==="loading");
    setInsightStatus(current?`${current.date} 자료를 확인하고 있습니다. 날짜별 진행 상황을 표시합니다.`:`다음 날짜 조회를 준비하고 있습니다.`,"loading");return;
  }
  if(counts.failed) setInsightStatus(`${counts.failed}일 조회에 실패했습니다. 날짜별 상태에서 실패한 날만 다시 시도할 수 있습니다.`,"error");
  else if(counts.empty) setInsightStatus(`${counts.empty}일은 정상적으로 조회했지만 자료가 없습니다. 차트는 해당 날짜에서 끊고 기간 합계·Top 5는 표시하지 않습니다.`,"warning");
  else setInsightStatus("모든 날짜에서 정상 결과를 받았습니다. 기간 합계와 영화 코드별 Top 5를 표시합니다.");
}
async function fetchInsightDate(entry,runId,controller) {
  entry.status="loading";entry.error="";renderInsightProgress(entry.date);updateInsightStatus();drawInsightData();
  try {
    const query=new URLSearchParams({date:entry.date,period:"daily"});
    const response=await fetch(`/api/boxoffice?${query}`,{signal:controller.signal,cache:"no-store"});
    const payload=await response.json();
    if(runId!==state.insightRequestId)return;
    if(!response.ok) throw new Error(payload.error?.message||"해당 날짜 조회에 실패했습니다.");
    if(!Array.isArray(payload.data?.movies)) throw new Error("해당 날짜 응답 형식이 올바르지 않습니다.");
    entry.movies=payload.data.movies;
    for(const movie of entry.movies) {
      if(typeof movie.movieCode!=="string"||!movie.movieCode||typeof movie.title!=="string") throw new Error("영화 코드 또는 영화명이 올바르지 않습니다.");
      toInteger(movie.revenue);toInteger(movie.audience);
    }
    entry.revenue=entry.movies.reduce((sum,movie)=>sum+BigInt(toInteger(movie.revenue)),0n);
    entry.status=entry.movies.length?"normal":"empty";
  } catch(error) {
    if(error.name==="AbortError"||runId!==state.insightRequestId)return;
    entry.status="failed";entry.movies=[];entry.error=error.message||"조회 오류";
  }
  if(runId!==state.insightRequestId)return;
  renderInsightProgress();drawInsightData();updateInsightStatus();
}
async function retryInsightDate(date) {
  const entry=state.insightEntries.find(item=>item.date===date);
  if(!entry||entry.status!=="failed")return;
  const controller=new AbortController();state.insightRetryControllers.set(date,controller);
  const runId=state.insightRequestId;
  await fetchInsightDate(entry,runId,controller);
  state.insightRetryControllers.delete(date);
}
async function loadInsights() {
  const endDate=$("dateInput").value,key=`${endDate}:${state.range}`;
  const parsedEndDate=new Date(`${endDate}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||Number.isNaN(parsedEndDate.getTime())||parsedEndDate.toISOString().slice(0,10)!==endDate) {
    if(state.insightController)state.insightController.abort();
    for(const controller of state.insightRetryControllers.values())controller.abort();
    state.insightRetryControllers.clear();state.insightKey=null;state.insightEntries=[];
    $("insightDateRange").textContent="조회 날짜를 선택하세요";$("insightProgress").max=state.range;$("insightProgress").value=0;
    $("progressLabel").textContent="조회 대기";$("progressValue").textContent=`0 / ${state.range}일`;
    for(const id of ["countNormal","countEmpty","countFailed","countLoading"])$(id).textContent="0";
    $("countPending").textContent=state.range;$("insightDays").replaceChildren();
    $("periodAudience").textContent="—";$("revenuePerAudience").textContent="—";$("topMoviesChart").replaceChildren();
    $("topMoviesPlaceholder").hidden=false;$("metricPlaceholder").hidden=false;$("metricPlaceholder").textContent="조회 날짜를 선택하면 기간 지표를 계산합니다.";
    $("revenueChart").replaceChildren();$("chartLabels").replaceChildren();setInsightStatus("F1에서 유효한 조회 날짜를 선택한 뒤 다시 확인하세요.","error");return;
  }
  if(state.insightKey===key&&state.insightEntries.length){renderInsightProgress();drawInsightData();updateInsightStatus();return;}
  if(state.insightController)state.insightController.abort();
  for(const controller of state.insightRetryControllers.values())controller.abort();
  state.insightRetryControllers.clear();
  const runId=++state.insightRequestId,controller=new AbortController();state.insightController=controller;
  state.insightKey=key;state.insightEntries=insightDates(endDate,state.range).map(date=>({date,status:"pending",movies:[],error:""}));
  $("insightDateRange").textContent=`${state.insightEntries[0].date} — ${endDate}`;
  renderInsightProgress();drawInsightData();
  for(const entry of state.insightEntries) {
    if(runId!==state.insightRequestId) return;
    await fetchInsightDate(entry,runId,controller);
  }
  if(runId===state.insightRequestId) {renderInsightProgress();updateInsightStatus();}
}
function renderInsights() { void loadInsights(); }
function showView(view) {
  const isInsights=view==="insights"; $("listView").hidden=isInsights; $("insightsView").hidden=!isInsights;
  $("crumb").textContent=isInsights?"인사이트":"박스오피스";
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.view===view));
  if(isInsights) renderInsights();
}
function wire() {
  document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
  document.querySelectorAll("[data-period]").forEach(button=>button.addEventListener("click",()=>{state.period=button.dataset.period;document.querySelectorAll("[data-period]").forEach(el=>el.classList.toggle("active",el===button));syncUrl();void runQuery();}));
  $("searchBtn").addEventListener("click",()=>{syncUrl();void runQuery();});
  $("searchInput").addEventListener("keydown",event=>{if(event.key==="Enter"){syncUrl();void runQuery();}});
  $("searchInput").addEventListener("input",()=>{$("clearSearch").hidden=!$("searchInput").value;});
  $("clearSearch").addEventListener("click",()=>{$("searchInput").value="";$("clearSearch").hidden=true;syncUrl();void runQuery();});
  $("dateInput").addEventListener("change",()=>{state.scenario="auto";$("scenarioSelect").value="auto";syncUrl();void runQuery();if(!$("insightsView").hidden){state.insightKey=null;renderInsights();}});
  document.querySelectorAll("[data-range]").forEach(button=>button.addEventListener("click",()=>{state.range=Number(button.dataset.range);document.querySelectorAll("[data-range]").forEach(el=>el.classList.toggle("active",el===button));renderInsights();}));
  $("insightDays").addEventListener("click",event=>{const button=event.target.closest("[data-retry-date]");if(button)void retryInsightDate(button.dataset.retryDate);});
  document.querySelectorAll(".banner-close").forEach(button=>button.addEventListener("click",()=>button.closest(".demo-banner").remove()));
  $("exportBtn").addEventListener("click",()=>toast("데모에서는 파일 내보내기를 지원하지 않습니다."));
  const updateLabel=document.querySelector(".update-label");
  updateLabel.innerHTML='<label for="scenarioSelect">상태 미리보기</label><select id="scenarioSelect" aria-label="화면 상태"><option value="auto">조회 조건으로 확인</option><option value="loading">로딩</option><option value="empty">정상 빈 결과</option><option value="error">오류</option></select>';
  $("scenarioSelect").value=state.scenario;
  $("scenarioSelect").addEventListener("change",event=>{state.scenario=event.target.value;syncUrl();void runQuery();});
}

function applyMode(mode) {
  state.mode=mode;
  const preview=document.querySelector(".update-label");
  const pill=document.querySelector(".sample-pill");
  const sideTitle=document.querySelector(".side-note b");
  const sideDetail=document.querySelector(".side-note small");
  const banners=document.querySelectorAll(".demo-banner");
  if(mode==="live") {
    state.scenario="auto";
    $("scenarioSelect").value="auto";
    preview.hidden=true;
    pill.innerHTML="<i></i> KOBIS 실데이터";
    sideTitle.textContent="KOBIS LIVE";
    sideDetail.textContent="F1·F2 실제 API";
    if(banners[0]) banners[0].querySelector("p").textContent="목록과 인사이트는 KOBIS 실제 응답을 서버에서 조회합니다.";
    if(banners[1]) banners[1].querySelector("p").textContent="차트는 일별 Top 10 실적 합계이며, 기간별 Top 영화도 실제 조회 자료로 계산합니다.";
    document.querySelector(".app-footer span:last-child").textContent="F1·F2 KOBIS 실제 조회 · API 키는 서버에서만 사용";
    const cards=document.querySelectorAll("#summaryGrid .summary-card small");
    if(cards[0]) cards[0].textContent="선택 조건 기준 · KOBIS 응답";
    if(cards[1]) cards[1].textContent="선택 조건 기준 · KOBIS 응답";
  } else {
    preview.hidden=false;
    pill.innerHTML="<i></i> 예시 데이터";
    sideTitle.textContent="샘플 데이터";
    sideDetail.textContent=mode==="demo"?"DATA_MODE=demo":"서버 모드 확인 필요";
    if(banners[0]) banners[0].querySelector("p").textContent="화면에 표시된 수치는 모두 가상 샘플입니다. 실제 KOBIS 데이터가 아닙니다.";
    if(banners[1]) banners[1].querySelector("p").textContent="차트와 지표는 가상 샘플을 바탕으로 표시합니다.";
    document.querySelector(".app-footer span:last-child").textContent="KOBIS 공개 데이터 기반 서비스 · 데모는 가상 데이터";
    const cards=document.querySelectorAll("#summaryGrid .summary-card small");
    if(cards[0]) cards[0].innerHTML='<span class="trend up">↑ 12.8%</span> 전일 대비';
    if(cards[1]) cards[1].innerHTML='<span class="trend up">↑ 8.3%</span> 전일 대비';
  }
}

async function initialize() {
  wire();
  if(!paramsOnLoad.has("date")) {
    const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
    $("dateInput").value=`${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,"0")}-${String(yesterday.getDate()).padStart(2,"0")}`;
  }
  try {
    const response=await fetch("/api/mode",{cache:"no-store"});
    const payload=await response.json();
    applyMode(payload.mode||"disabled");
  } catch {
    applyMode("disabled");
  }
  if(state.mode!=="demo") state.scenario="auto";
  $("scenarioSelect").value=state.scenario;
  void runQuery();
}

const initialDate=paramsOnLoad.get("date"); if(initialDate) $("dateInput").value=initialDate;
const initialQuery=paramsOnLoad.get("q"); if(initialQuery){$("searchInput").value=initialQuery;$("clearSearch").hidden=false;}
const initialPeriod=paramsOnLoad.get("period"); if(["daily","weekly","weekend"].includes(initialPeriod)){state.period=initialPeriod;document.querySelectorAll("[data-period]").forEach(button=>button.classList.toggle("active",button.dataset.period===state.period));}
const initialScenario=paramsOnLoad.get("state"); if(["loading","empty","error"].includes(initialScenario)) state.scenario=initialScenario;
void initialize();
