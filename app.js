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
const state = {period:"daily",scenario:"auto",mode:"unknown",range:7,top:5,toastTimer:null,controller:null,requestId:0,insightController:null,insightRequestId:0,insightData:null,insightKey:null};
const fmt = new Intl.NumberFormat("ko-KR");
const won = (value) => `₩ ${fmt.format(value)}`;
const compactWon = (value) => value >= 100000000 ? `₩ ${(value/100000000).toFixed(0)}억` : `₩ ${fmt.format(Math.round(value))}`;
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
function chartSeries(days) {
  return Array.from({length:days},(_,i) => {
    const wave=Math.sin((i+2)*1.71)*.22+Math.cos(i*.57)*.14;
    const weekend=(i%7===5||i%7===6)?.22:0;
    return Math.max(.15,.48+wave+weekend+(i/days)*.12);
  });
}
function renderDemoInsights() {
  const series=chartSeries(state.range); const total=series.reduce((a,b)=>a+b,0)*1000000000;
  const audience=Math.round(series.reduce((a,b)=>a+b,0)*210000);
  $("chartTotal").textContent=won(total); $("periodAudience").textContent=`${fmt.format(audience)}명`; $("averageRevenue").textContent=won(total/state.range);
  const chart=$("revenueChart"); chart.replaceChildren(); const max=Math.max(...series);
  series.forEach((value,index)=>{const wrap=document.createElement("div");wrap.className="bar-wrap";const bar=document.createElement("div");bar.className=`bar ${index===series.length-1?"current":""}`;bar.style.height=`${Math.max(12,value/max*94)}%`;bar.title=`${state.range-index-1}일 전 · ${won(value*1000000000)}`;wrap.append(bar);chart.append(wrap);});
  const labels=$("chartLabels");labels.replaceChildren();const count=state.range===7?7:state.range===14?7:6;
  for(let i=0;i<count;i++){const label=document.createElement("span");label.textContent=state.range===7?`${i+18}일`:`${Math.round(i*(state.range-1)/(count-1))+1}일 전`;labels.append(label);}
  const sorted=films.map(film=>({...film,periodRevenue:Math.round(num(film.revenue)*state.range*.82),periodAudience:Math.round(num(film.audience)*state.range*.87)})).sort((a,b)=>b.periodRevenue-a.periodRevenue).slice(0,state.top);
  const tbody=$("topRows");tbody.replaceChildren();const allRevenue=films.reduce((sum,film)=>sum+num(film.revenue)*state.range*.82,0);
  sorted.forEach((film,index)=>{const tr=document.createElement("tr");const share=film.periodRevenue/allRevenue*100;tr.innerHTML=`<td><span class="rank-badge ${rankClass(index+1)}">${index+1}</span></td><td><div class="movie-cell"><div class="poster p${index+1}">${film.tag}</div><div><div class="movie-name"></div><div class="movie-meta"></div></div></div></td><td class="numeric revenue">${won(film.periodRevenue)}</td><td class="numeric">${fmt.format(film.periodAudience)}명</td><td><div class="share-cell"><span>${share.toFixed(1)}%</span><div class="share-track"><div class="share-fill" style="width:${share}%"></div></div></div></td>`;tr.querySelector(".movie-name").textContent=film.title;tr.querySelector(".movie-meta").textContent=film.genre;tbody.append(tr);});
}
function setInsightStatus(message="",kind="") {
  const status=$("insightStatus");
  status.hidden=!message;
  status.textContent=message;
  status.dataset.kind=kind;
}
function drawLiveInsights(payload) {
  const {series,topMovies,summary:totals}=payload.data;
  if(!Array.isArray(series)||!Array.isArray(topMovies)||!totals) throw new Error("인사이트 응답 형식이 올바르지 않습니다.");
  const values=series.map(day=>toInteger(day.revenue));
  const totalRevenue=toInteger(totals.totalRevenue);
  const totalAudience=toInteger(totals.totalAudience);
  const averageRevenue=toInteger(totals.averageRevenue);
  $("chartTotal").textContent=won(totalRevenue);
  $("periodAudience").textContent=`${fmt.format(totalAudience)}명`;
  $("averageRevenue").textContent=won(averageRevenue);
  $("insightsView").querySelector(".insight-date span").textContent=`${payload.meta.rangeStart} — ${payload.meta.rangeEnd}`;
  $("insightsView").querySelector(".insight-controls p").textContent="KOBIS 일별 Top 10 매출 합계";
  const change=$("insightsView").querySelector(".chart-change");
  change.textContent="일별 매출";
  const changeNote=document.createElement("small"); changeNote.textContent="KOBIS Top 10 합계"; change.append(changeNote);
  const chart=$("revenueChart"); chart.replaceChildren();
  const max=Math.max(...values,1);
  series.forEach((day,index)=>{
    const wrap=document.createElement("div"); wrap.className="bar-wrap";
    const bar=document.createElement("div"); bar.className=`bar ${index===series.length-1?"current":""}`;
    bar.style.height=`${Math.max(1,values[index]/max*94)}%`;
    bar.title=`${day.date} · ${won(values[index])}`;
    wrap.append(bar); chart.append(wrap);
  });
  const yLabels=document.querySelectorAll(".y-labels span");
  yLabels.forEach((label,index)=>{label.textContent=compactWon(max*(3-index)/3);});
  const labels=$("chartLabels"); labels.replaceChildren();
  const tickCount=Math.min(7,series.length);
  for(let index=0;index<tickCount;index++){
    const dataIndex=tickCount===1?0:Math.round(index*(series.length-1)/(tickCount-1));
    const label=document.createElement("span"); label.textContent=series[dataIndex].date.slice(5); labels.append(label);
  }
  const tbody=$("topRows"); tbody.replaceChildren();
  topMovies.slice(0,state.top).forEach((movie,index)=>{
    const tr=document.createElement("tr");
    const rank=document.createElement("td"); const badge=document.createElement("span"); badge.className=`rank-badge ${rankClass(index+1)}`; badge.textContent=String(index+1); rank.append(badge);
    const movieCell=document.createElement("td"); const wrap=document.createElement("div"); wrap.className="movie-cell";
    const poster=document.createElement("div"); poster.className=`poster p${index+1}`; poster.textContent=movie.title.slice(0,1);
    const details=document.createElement("div"); const name=document.createElement("div"); name.className="movie-name"; name.textContent=movie.title;
    const meta=document.createElement("div"); meta.className="movie-meta"; meta.textContent=movie.releaseDate?`개봉 ${movie.releaseDate}`:"";
    details.append(name,meta); wrap.append(poster,details); movieCell.append(wrap);
    const revenue=document.createElement("td"); revenue.className="numeric revenue"; revenue.textContent=won(toInteger(movie.revenue));
    const audience=document.createElement("td"); audience.className="numeric"; audience.textContent=`${fmt.format(toInteger(movie.audience))}명`;
    const shareCell=document.createElement("td"); const shareWrap=document.createElement("div"); shareWrap.className="share-cell";
    const shareText=document.createElement("span"); shareText.textContent=`${(Number(movie.share)*100).toFixed(1)}%`;
    const track=document.createElement("div"); track.className="share-track"; const fill=document.createElement("div"); fill.className="share-fill"; fill.style.width=`${Math.max(0,Math.min(100,Number(movie.share)*100))}%`;
    track.append(fill); shareWrap.append(shareText,track); shareCell.append(shareWrap); tr.append(rank,movieCell,revenue,audience,shareCell); tbody.append(tr);
  });
  if(payload.meta?.warning?.message) setInsightStatus(payload.meta.warning.message,"warning");
  else setInsightStatus(totalRevenue===0?"선택한 기간에 집계할 KOBIS Top 10 박스오피스 기록이 없습니다.":"");
}
async function loadLiveInsights() {
  const endDate=$("dateInput").value;
  const key=`${endDate}:${state.range}`;
  if(state.insightData&&state.insightKey===key){drawLiveInsights(state.insightData);return;}
  if(state.insightController) state.insightController.abort();
  const requestId=++state.insightRequestId;
  state.insightController=new AbortController();
  state.insightData=null;
  setInsightStatus(`KOBIS에서 최근 ${state.range}일 자료를 조회하고 있습니다. 날짜별 데이터를 모으는 데 잠시 걸릴 수 있습니다.`,"loading");
  $("chartTotal").textContent="조회 중"; $("periodAudience").textContent="조회 중"; $("averageRevenue").textContent="조회 중";
  $("revenueChart").replaceChildren(); $("topRows").replaceChildren();
  try {
    const params=new URLSearchParams({endDate,days:String(state.range),limit:"10"});
    const response=await fetch(`/api/insights?${params.toString()}`,{signal:state.insightController.signal,cache:"no-store"});
    const payload=await response.json();
    if(requestId!==state.insightRequestId)return;
    if(!response.ok) {const error=new Error(payload.error?.message||"인사이트 조회에 실패했습니다.");error.warning=payload.meta?.warning;throw error;}
    if(payload.meta?.daysComplete!==payload.meta?.daysRequested) throw new Error("요청한 기간의 데이터가 모두 모이지 않았습니다.");
    state.insightData=payload; state.insightKey=key; drawLiveInsights(payload);
  } catch(error) {
    if(error.name==="AbortError"||requestId!==state.insightRequestId)return;
    $("chartTotal").textContent="—"; $("periodAudience").textContent="—"; $("averageRevenue").textContent="—";
    $("revenueChart").replaceChildren(); $("topRows").replaceChildren();
    const message=[error.message,error.warning?.message].filter(Boolean).join(" ")||"KOBIS 인사이트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    setInsightStatus(message,"error");
  }
}
function renderInsights() {
  if(state.mode==="live") void loadLiveInsights();
  else {setInsightStatus("");renderDemoInsights();}
}
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
  $("dateInput").addEventListener("change",()=>{state.scenario="auto";$("scenarioSelect").value="auto";syncUrl();void runQuery();if(!$("insightsView").hidden){state.insightData=null;state.insightKey=null;renderInsights();}});
  document.querySelectorAll("[data-range]").forEach(button=>button.addEventListener("click",()=>{state.range=Number(button.dataset.range);document.querySelectorAll("[data-range]").forEach(el=>el.classList.toggle("active",el===button));renderInsights();}));
  document.querySelectorAll("[data-top]").forEach(button=>button.addEventListener("click",()=>{state.top=Number(button.dataset.top);document.querySelectorAll("[data-top]").forEach(el=>el.classList.toggle("active",el===button));renderInsights();}));
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
