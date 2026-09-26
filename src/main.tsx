import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPublicClient, createWalletClient, custom, decodeEventLog, defineChain, formatUnits, http, isAddress, keccak256, parseUnits, stringToHex, type Address, type Hash } from 'viem'
import abi from './generated/abi.json'
import './style.css'

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } } }

const chain = defineChain({ id: Number(import.meta.env.VITE_CHAIN_ID || 10143), name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz'] } }, blockExplorers: { default: { name: 'Monadscan', url: import.meta.env.VITE_EXPLORER_URL || 'https://testnet.monadscan.com' } } })
const contract = import.meta.env.VITE_CONTRACT_ADDRESS as Address | undefined
const token = (import.meta.env.VITE_TOKEN_ADDRESS || '0x534b2f3A21130d7a60830c2Df862319e593943A3') as Address
const symbol = import.meta.env.VITE_TOKEN_SYMBOL || 'USDC'
const decimals = Number(import.meta.env.VITE_TOKEN_DECIMALS || 6)
const explorer = chain.blockExplorers.default.url
const publicClient = createPublicClient({ chain, transport: http() })
const erc20Abi = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

type Story = { title: string; story: string; community: string; workUrl: string; coverUrl: string; rules: string }
type Evidence = { title: string; description: string; evidenceUrl: string; displayName: string; consent: true }
type Stored<T> = { content?: T; hash: string; txHash: Hash; hidden?: boolean; hideReason?: string }
type ChainSeason = { creator: Address; payoutAddress: Address; reviewers: readonly Address[]; submissionEnd: bigint; reviewEnd: bigint; tipEnd: bigint; contributorBps: number; metadataHash: Hash; status: number; totalTips: bigint; creatorAllocation: bigint; contributorAllocation: bigint; totalWeight: bigint; creatorClaimed: bigint; submissionCount: number; contributorCount: number }
type ChainContribution = { seasonId: bigint; contributor: Address; category: number; contentHash: Hash; approvals: number; rejections: number; withdrawn: boolean }
type Entry = { id: number; data: ChainContribution; stored?: Stored<Evidence>; weight?: bigint; claimable?: bigint }
type SeasonView = { id: number; data: ChainSeason; stored?: Stored<Story>; entries: Entry[]; creatorClaimable: bigint; myClaimable: bigint; ledger: { name: string; tx: Hash; block: bigint; detail: string }[]; ledgerError?: string }

const shorten = (s?: string) => s ? `${s.slice(0, 6)}…${s.slice(-4)}` : '—'
const date = (seconds: bigint) => new Date(Number(seconds) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const amount = (value: bigint) => Number(formatUnits(value, decimals)).toLocaleString('zh-CN', { maximumFractionDigits: decimals })
const stage = (s: ChainSeason) => s.status === 3 ? '无合格贡献' : s.status === 2 ? '已结束 · 可领取' : s.status === 1 ? '已锁定 · 可打赏' : Date.now() / 1000 < Number(s.submissionEnd) ? '征集贡献中' : Date.now() / 1000 < Number(s.reviewEnd) ? '审核中' : '待锁定名单'
const votes = (n: number) => [0, 1, 2].filter(i => (n & (1 << i)) !== 0).length
const categories = ['长文教程 / 翻译', '原创视觉 / 组织活动', '证据支持的新手答疑']
const weights = [3, 2, 1]
const safeLink = (url?: string) => { try { const x = new URL(url || ''); return ['https:', 'http:'].includes(x.protocol) ? x.href : undefined } catch { return undefined } }
const hashContent = (x: object) => keccak256(stringToHex(JSON.stringify(x)))
async function stored<T extends object>(kind: 'season' | 'contribution', id: number, hash: string): Promise<Stored<T> | undefined> {
  try { const r = await fetch(`/api/${kind}/${id}`); if (!r.ok) return; const item = await r.json() as Stored<T>; if (item.hash.toLowerCase() !== hash.toLowerCase()) return; if (item.hidden) return item; if (item.content && hashContent(item.content).toLowerCase() === hash.toLowerCase()) return item } catch { /* content service unavailable */ }
}
async function persist<T>(kind: 'season' | 'contribution', id: number, content: T, txHash: Hash) {
  const r = await fetch(`/api/${kind}/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, txHash }) })
  if (!r.ok) throw new Error((await r.json()).error || '内容保存失败')
}

function App() {
  const [account, setAccount] = useState<Address>()
  const [route, setRoute] = useState(location.pathname)
  const [seasonIds, setSeasonIds] = useState<number[]>([])
  const [view, setView] = useState<SeasonView>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tipAmount, setTipAmount] = useState('10')
  const [story, setStory] = useState<Story>({ title: '', story: '', community: '', workUrl: '', coverUrl: '', rules: '每项贡献由三位审核人独立确认，至少两票认可才计入片尾名单。分账只覆盖本季在此应用内收到的测试网打赏，不涉及项目股权、版权或场外收入。' })
  const [reviewers, setReviewers] = useState(['', '', ''])
  const [payout, setPayout] = useState('')
  const [bps, setBps] = useState(20)
  const [times, setTimes] = useState({ submission: '', review: '', tip: '' })
  const [evidence, setEvidence] = useState({ title: '', description: '', evidenceUrl: '', displayName: '', consent: false, category: 0 })

  const seasonId = Number(route.match(/^\/season\/(\d+)/)?.[1] || 0)
  const configured = !!contract && isAddress(contract)
  function navigate(path: string) { history.pushState({}, '', path); setRoute(path); setError(''); setNotice(''); window.scrollTo(0, 0) }
  useEffect(() => { const fn = () => setRoute(location.pathname); addEventListener('popstate', fn); return () => removeEventListener('popstate', fn) }, [])
  useEffect(() => { if (account && !payout) setPayout(account) }, [account, payout])
  useEffect(() => { if (!configured) return; publicClient.readContract({ address: contract, abi, functionName: 'seasonCount' }).then(n => setSeasonIds(Array.from({ length: Number(n) }, (_, i) => Number(n) - i))).catch(e => setError(`读取链上季列表失败：${e.shortMessage || e.message}`)) }, [configured, route, notice])
  useEffect(() => { if (!seasonId || !configured) { setView(undefined); return } loadSeason(seasonId).catch(e => setError(`读取链上季失败：${e.shortMessage || e.message}`)) }, [seasonId, account, notice, configured])

  async function connect() {
    if (!window.ethereum) throw new Error('请安装支持 Monad Testnet 的 EVM 钱包')
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as Address[]
    const current = await window.ethereum.request({ method: 'eth_chainId' }) as string
    if (Number(current) !== chain.id) {
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chain.id.toString(16)}` }] }) }
      catch { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${chain.id.toString(16)}`, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [explorer] }] }) }
    }
    setAccount(accounts[0]); return accounts[0]
  }
  async function send(name: string, args: readonly unknown[], target: Address = contract!) {
    const actor = account || await connect()
    if (!window.ethereum) throw new Error('钱包不可用')
    const wallet = createWalletClient({ account: actor, chain, transport: custom(window.ethereum) })
    setBusy('等待钱包签名…')
    const hash = await wallet.writeContract({ address: target, abi: target.toLowerCase() === token.toLowerCase() ? erc20Abi : abi, functionName: name, args } as never)
    setBusy('交易已广播，等待链上确认…')
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('链上交易失败')
    setBusy(''); setNotice(`交易已确认：${hash}`)
    return { hash, receipt }
  }
  async function action(label: string, fn: () => Promise<void>) { try { setError(''); setNotice(''); setBusy(label); await fn() } catch (e) { const x = e as { shortMessage?: string; message?: string; code?: number }; setError(x?.shortMessage || x?.message || (x?.code === 4001 ? '钱包操作已取消' : '钱包或网络请求失败，请检查钱包状态')) } finally { setBusy('') } }

  async function loadSeason(id: number) {
    const data = await publicClient.readContract({ address: contract!, abi, functionName: 'getSeason', args: [BigInt(id)] }) as ChainSeason
    if (!data.creator || data.creator === '0x0000000000000000000000000000000000000000') throw new Error('这一季不存在')
    const ids = await publicClient.readContract({ address: contract!, abi, functionName: 'getSeasonContributionIds', args: [BigInt(id)] }) as bigint[]
    const entries = await Promise.all(ids.map(async raw => {
      const entryId = Number(raw)
      const c = await publicClient.readContract({ address: contract!, abi, functionName: 'getContribution', args: [raw] }) as ChainContribution
      const content = await stored<Evidence>('contribution', entryId, c.contentHash)
      const weight = await publicClient.readContract({ address: contract!, abi, functionName: 'weightOf', args: [BigInt(id), c.contributor] }) as bigint
      const claimable = await publicClient.readContract({ address: contract!, abi, functionName: 'getClaimableContributor', args: [BigInt(id), c.contributor] }) as bigint
      return { id: entryId, data: c, stored: content, weight, claimable }
    }))
    const content = await stored<Story>('season', id, data.metadataHash)
    const creatorClaimable = await publicClient.readContract({ address: contract!, abi, functionName: 'getClaimableCreator', args: [BigInt(id)] }) as bigint
    const myClaimable = account ? await publicClient.readContract({ address: contract!, abi, functionName: 'getClaimableContributor', args: [BigInt(id), account] }) as bigint : 0n
    const ledger: SeasonView['ledger'] = []
    let ledgerError = ''
    try {
      const fromBlock = BigInt(import.meta.env.VITE_DEPLOYMENT_BLOCK || 0)
      for (const name of ['SeasonFinalized', 'ContributionReviewed', 'TipReceived', 'CreatorClaimed', 'ContributorClaimed', 'SeasonClosed']) {
        const events = await publicClient.getContractEvents({ address: contract!, abi, eventName: name, args: { seasonId: BigInt(id) }, fromBlock, toBlock: 'latest' } as never)
        for (const event of events) {
          const a = (event as { args: Record<string, unknown> }).args
          const detail = name === 'TipReceived' ? `${amount(a.amount as bigint)} ${symbol} · ${shorten(a.sender as string)}` : name === 'ContributionReviewed' ? `#${a.contributionId} · ${a.approved ? '认可' : '拒绝'}` : name === 'ContributorClaimed' || name === 'CreatorClaimed' ? `${amount(a.amount as bigint)} ${symbol}` : ''
          ledger.push({ name, tx: event.transactionHash!, block: event.blockNumber!, detail })
        }
      }
      ledger.sort((a, b) => Number(b.block - a.block))
    } catch { ledgerError = '公共账本事件暂时无法加载，请用浏览器查看合约交易。' }
    setView({ id, data, stored: content, entries, creatorClaimable, myClaimable, ledger, ledgerError })
  }

  async function createSeason(e: React.FormEvent) {
    e.preventDefault()
    await action('准备发布这一季…', async () => {
      if (!configured) throw new Error('尚未配置已部署合约')
      const actor = account || await connect()
      const addresses = reviewers.map(x => x.trim())
      if (!isAddress(payout) || addresses.some(x => !isAddress(x)) || new Set(addresses.map(x => x.toLowerCase())).size !== 3 || addresses.some(x => x.toLowerCase() === actor.toLowerCase())) throw new Error('请输入三个不同审核人地址，且项目方不能担任审核人')
      if (!safeLink(story.workUrl) || (story.coverUrl && !safeLink(story.coverUrl))) throw new Error('作品和封面须为有效的网页链接')
      const ends = [times.submission, times.review, times.tip].map(x => Math.floor(new Date(x).getTime() / 1000))
      if (!(ends[0] > Date.now() / 1000 && ends[1] > ends[0] && ends[2] >= ends[1] + 48 * 3600)) throw new Error('提交、审核、打赏时间需依次递增，打赏期至少 48 小时')
      const { hash, receipt } = await send('createSeason', [{ payoutAddress: payout, reviewers: addresses, submissionEnd: BigInt(ends[0]), reviewEnd: BigInt(ends[1]), tipEnd: BigInt(ends[2]), contributorBps: bps * 100, metadataHash: hashContent(story) }])
      const log = receipt.logs.find(x => { if (x.address.toLowerCase() !== contract!.toLowerCase()) return false; try { return decodeEventLog({ abi, data: x.data, topics: x.topics }).eventName === 'SeasonCreated' } catch { return false } })
      if (!log) throw new Error('链上已确认，但回执缺少 SeasonCreated 事件。请用交易链接核查。')
      const id = Number((decodeEventLog({ abi, data: log.data, topics: log.topics }).args as unknown as { seasonId: bigint }).seasonId)
      await persist('season', id, story, hash)
      navigate(`/season/${id}`)
    })
  }

  async function submitContribution(e: React.FormEvent) {
    e.preventDefault()
    await action('准备提交贡献…', async () => {
      if (!view) throw new Error('季资料尚未加载')
      if (!safeLink(evidence.evidenceUrl) || !evidence.consent) throw new Error('请提供公开证据链接并确认授权')
      const content: Evidence = { title: evidence.title, description: evidence.description, evidenceUrl: evidence.evidenceUrl, displayName: evidence.displayName, consent: true }
      const { hash, receipt } = await send('submitContribution', [BigInt(view.id), evidence.category, hashContent(content)])
      const log = receipt.logs.find(x => { if (x.address.toLowerCase() !== contract!.toLowerCase()) return false; try { return decodeEventLog({ abi, data: x.data, topics: x.topics }).eventName === 'ContributionSubmitted' } catch { return false } })
      if (!log) throw new Error('链上已确认，但回执缺少 ContributionSubmitted 事件。请用交易链接核查。')
      const id = Number((decodeEventLog({ abi, data: log.data, topics: log.topics }).args as unknown as { contributionId: bigint }).contributionId)
      await persist('contribution', id, content, hash)
      await loadSeason(view.id)
      setEvidence({ title: '', description: '', evidenceUrl: '', displayName: '', consent: false, category: 0 })
    })
  }

  async function tip() {
    if (!view) return
    await action('准备打赏…', async () => {
      const n = parseUnits(tipAmount, decimals)
      if (n <= 0n) throw new Error('请输入大于零的金额')
      const actor = account || await connect()
      const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [actor, contract!] })
      if (allowance < n) await send('approve', [contract!, n], token)
      await send('tip', [BigInt(view.id), n])
      await loadSeason(view.id)
    })
  }

  async function hideContribution(id: number) {
    if (!view) return
    const reason = window.prompt('请写明隐藏展示的原因。链上确认和资金分配不会改变。', '材料存在权属争议，暂时隐藏展示。')
    if (!reason) return
    await action('验证项目方签名并隐藏材料…', async () => {
      const actor = account || await connect()
      if (!window.ethereum || !contract) throw new Error('钱包或合约不可用')
      const wallet = createWalletClient({ account: actor, chain, transport: custom(window.ethereum) })
      const message = `End Credits hide contribution #${id} on ${contract}: ${reason}`
      const signature = await wallet.signMessage({ account: actor, message })
      const response = await fetch(`/api/contribution/${id}/hide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, signature }) })
      if (!response.ok) throw new Error((await response.json()).error || '隐藏失败')
      await loadSeason(view.id)
      setNotice('展示材料已隐藏；链上记录和分账未变。')
    })
  }

  const isReviewer = !!account && !!view?.data.reviewers.some(x => x.toLowerCase() === account.toLowerCase())
  const isCreator = !!account && !!view && account.toLowerCase() === view.data.creator.toLowerCase()
  const sample = { title: '每一次发布，都有一群幕后的人', community: '概念示例 · 尚未上链', story: '有人写下第一篇指南，有人把界面翻译成另一种语言，有人拉来第一批体验者。作品发布时，这些名字也该被看见。' }

  return <div className="app">
    <header className="topbar"><button className="brand" onClick={() => navigate('/')}><span className="brand-mark">✳</span> 片尾字幕 <small>END CREDITS</small></button><nav><button onClick={() => navigate('/')}>探索片尾</button><button onClick={() => navigate('/create')}>开启一季</button><a href="#how">运作方式</a></nav><div className="top-actions"><span className="network"><i/> MONAD TESTNET</span><button className="wallet" onClick={() => action('连接钱包…', async () => { await connect() })}>{account ? shorten(account) : '连接钱包 ↗'}</button></div></header>
    {error && <div className="toast error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {notice && <div className="toast success" role="status">{notice.startsWith('交易已确认：') ? <a target="_blank" rel="noreferrer" href={`${explorer}/tx/${notice.split('：')[1]}`}>交易已确认 · 查看链上记录 ↗</a> : notice}<button onClick={() => setNotice('')}>×</button></div>}
    {busy && <div className="processing" role="status"><span className="spinner"/>{busy}</div>}

    {route === '/' && <><main className="home"><section className="hero"><div className="eyebrow"><span className="line"/> A SEASON OF RECOGNITION <span className="line"/></div><h1>他们让这个作品<br/><em>被更多人看见。</em></h1><p>创作者登场，幕后的人也该出现在片尾。记录真实贡献，社区共同确认，让每一次支持按公开规则流向整个团队。</p><div className="hero-buttons"><button className="primary" onClick={() => navigate('/create')}>开启你的片尾字幕 <span>↗</span></button><a href="#seasons" className="text-link">看看正在发生的故事 ↓</a></div><div className="hero-foot"><span>✦ 可核验的贡献</span><span>✦ 三人审核，两票确认</span><span>✦ 站内打赏自动记账</span></div></section>
    <section className="featured" id="seasons"><div className="section-head"><div><span className="overline">THE STORIES</span><h2>正在放映</h2></div><p>每一季，只讲一个作品和帮助它走出去的人。</p></div><div className="cards">{seasonIds.length === 0 && <article className="season-card sample"><div className="card-art"><span>DEMO / CONCEPT</span><strong>THE PEOPLE<br/>BEHIND<br/>THE WORK.</strong><b>✳</b></div><div className="card-copy"><span className="badge">概念示例 · 非真实活动</span><h3>{sample.title}</h3><p>{sample.story}</p><div className="card-bottom"><span>{sample.community}</span><button onClick={() => navigate('/create')}>开启第一季 ↗</button></div></div></article>}{seasonIds.map(id => <SeasonCard key={id} id={id} open={() => navigate(`/season/${id}`)}/>)}</div></section>
    <section className="manifesto" id="how"><span className="overline">HOW IT WORKS</span><h2>从一句感谢，到一份<br/>可验证的承诺。</h2><div className="steps"><div><b>01</b><h3>开启一季</h3><p>项目方发布作品故事、审核人和贡献者份额。发布后规则锁定。</p></div><div><b>02</b><h3>写下贡献</h3><p>帮助者提交公开证据。三位审核人独立判断，至少两人认可才入选。</p></div><div><b>03</b><h3>片尾名单锁定</h3><p>审核结束后按贡献权重锁定名单。支持者付款前就能看到分配规则。</p></div><div><b>04</b><h3>支持与领取</h3><p>站内测试币打赏进入合约，项目方和片尾贡献者按比例领取。</p></div></div></section></main></>}

    {route === '/create' && <main className="form-page"><div className="page-intro"><span className="overline">CREATE A SEASON</span><h1>为作品开启一季<br/><em>片尾字幕。</em></h1><p>写下作品背后的故事，并提前承诺这一季站内打赏中属于贡献者的份额。</p></div><div className="form-layout"><form onSubmit={createSeason} className="panel form-panel"><h2>01 / 故事</h2><label>本季标题<input required maxLength={120} placeholder="例如：独立游戏 1.0 发布" value={story.title} onChange={e => setStory({ ...story, title: e.target.value })}/></label><label>社区名称<input required maxLength={120} placeholder="你的团队或社区" value={story.community} onChange={e => setStory({ ...story, community: e.target.value })}/></label><label>作品故事<textarea required maxLength={3000} rows={5} placeholder="谁做了这个作品？幕后的人怎样帮它走向更多人？" value={story.story} onChange={e => setStory({ ...story, story: e.target.value })}/></label><div className="grid-two"><label>主作品链接<input required type="url" placeholder="https://" value={story.workUrl} onChange={e => setStory({ ...story, workUrl: e.target.value })}/></label><label>封面图片链接 <small>可选</small><input type="url" placeholder="https://" value={story.coverUrl} onChange={e => setStory({ ...story, coverUrl: e.target.value })}/></label></div><h2>02 / 公开规则</h2><label>贡献者份额 <strong>{bps}%</strong><input type="range" min="5" max="30" value={bps} onChange={e => setBps(Number(e.target.value))}/><small>其余 {100 - bps}% 归项目方。只覆盖本季在本应用内收到的测试币打赏。</small></label><label>项目方收款地址<input required placeholder="0x…" value={payout} onChange={e => setPayout(e.target.value)}/></label><label>规则说明<textarea required maxLength={3000} rows={4} value={story.rules} onChange={e => setStory({ ...story, rules: e.target.value })}/></label><h2>03 / 审核与时间</h2>{reviewers.map((x, i) => <label key={i}>审核人 {i + 1} 地址<input required placeholder="0x…" value={x} onChange={e => setReviewers(reviewers.map((v, n) => i === n ? e.target.value : v))}/></label>)}<div className="grid-three"><label>投稿截止<input required type="datetime-local" value={times.submission} onChange={e => setTimes({ ...times, submission: e.target.value })}/></label><label>审核截止<input required type="datetime-local" value={times.review} onChange={e => setTimes({ ...times, review: e.target.value })}/></label><label>打赏截止<input required type="datetime-local" value={times.tip} onChange={e => setTimes({ ...times, tip: e.target.value })}/></label></div><p className="form-note">发布会产生 Monad Testnet 交易。故事快照、审核人、时间和分账比例发布后不可修改。时间按你设备的本地时区填写。</p><button type="submit" className="primary full" disabled={!!busy || !configured}>发布这一季 ↗</button>{!configured && <p className="warning">尚未部署合约。可预览页面，完成部署配置后才能发布。</p>}</form><aside className="preview panel"><span className="overline">LIVE PREVIEW</span><div className="preview-art" style={safeLink(story.coverUrl) ? { backgroundImage: `linear-gradient(transparent,#151618cc),url(${safeLink(story.coverUrl)})` } : undefined}><span>SEASON 01</span><b>✳</b></div><span className="badge">MONAD TESTNET · 草稿预览</span><h3>{story.title || '你的作品，和幕后的人。'}</h3><p>{story.story || '在这里预览作品故事。真实发布前，可以继续修改。'}</p><div className="split-bar"><span style={{ width: `${100 - bps}%` }}/><span style={{ width: `${bps}%` }}/></div><div className="split-label"><span>项目方 {100 - bps}%</span><span>贡献者 {bps}%</span></div><p className="muted">作品 · {story.community || '社区名称'}</p></aside></div></main>}

    {seasonId > 0 && <main className="season-page">{!view ? <div className="loading">正在读取链上片尾…</div> : <><div className="season-hero"><div className="season-cover" style={safeLink(view.stored?.content?.coverUrl) ? { backgroundImage: `linear-gradient(90deg,#141416a8,#1414164d),url(${safeLink(view.stored?.content?.coverUrl)})` } : undefined}><span className="overline">SEASON {String(view.id).padStart(2, '0')} / {view.stored?.content?.community || '原始材料暂不可用'}</span><h1>{view.stored?.content?.title || '原始材料暂不可用'}</h1><div className="cover-actions"><span className="badge">{stage(view.data)}</span>{view.stored?.content?.workUrl && <a href={safeLink(view.stored.content?.workUrl)} target="_blank" rel="noreferrer">观看主作品 ↗</a>}</div></div><div className="season-story"><span className="overline">THE STORY</span><h2>每一个名字<br/>都有来处。</h2><p>{view.stored?.content?.story || '链上元数据哈希存在，但原始故事材料暂不可用。请勿将此页面视为内容已核验。'}</p></div></div>
    <div className="season-grid"><section className="main-column"><div className="section-head"><div><span className="overline">END CREDITS</span><h2>片尾名单</h2></div><p>{view.data.status >= 1 ? '名单已按审核结果锁定' : '贡献正在收集或审核中'}</p></div><div className="entries">{view.entries.length === 0 && <div className="empty">还没有贡献。第一位幕后伙伴会出现在这里。</div>}{view.entries.map(entry => <article className="entry" key={entry.id}><div className="entry-number">{String(entry.id).padStart(2, '0')}</div><div className="entry-body"><div className="entry-top"><span className="badge">{categories[entry.data.category]} · 权重 {weights[entry.data.category]}</span><span className={`entry-status ${entry.data.withdrawn ? 'muted' : votes(entry.data.approvals) >= 2 ? 'approved' : votes(entry.data.rejections) >= 2 ? 'rejected' : ''}`}>{entry.data.withdrawn ? '已撤回' : votes(entry.data.approvals) >= 2 ? '两票认可' : votes(entry.data.rejections) >= 2 ? '两票拒绝' : Date.now() / 1000 >= Number(view.data.reviewEnd) ? '未获足够确认' : `认可 ${votes(entry.data.approvals)}/2`}</span></div><h3>{entry.stored?.hidden ? '展示材料已隐藏' : entry.stored?.content?.title || '原始材料暂不可用'}</h3><p>{entry.stored?.hidden ? `因权属争议隐藏：${entry.stored.hideReason}。链上审核和资金分配不变。` : entry.stored?.content?.description || '链上哈希仍可核验；此处内容服务暂不可用。'}</p><div className="entry-meta"><span>署名 · {entry.stored?.content?.displayName || shorten(entry.data.contributor)}</span>{entry.stored?.content?.evidenceUrl && <a href={safeLink(entry.stored.content.evidenceUrl)} target="_blank" rel="noreferrer">查看贡献证据 ↗</a>}<span>{shorten(entry.data.contributor)}</span></div>{isCreator && !!entry.stored?.content && <button className="subtle" onClick={() => hideContribution(entry.id)}>隐藏有争议的展示材料</button>}{entry.data.withdrawn === false && view.data.status === 0 && account?.toLowerCase() === entry.data.contributor.toLowerCase() && Date.now() / 1000 < Number(view.data.submissionEnd) && <button className="subtle" onClick={() => action('撤回贡献…', async () => { await send('withdrawContribution', [BigInt(entry.id)]); await loadSeason(view.id) })}>撤回投稿</button>}{isReviewer && Date.now() / 1000 >= Number(view.data.submissionEnd) && Date.now() / 1000 < Number(view.data.reviewEnd) && !entry.data.withdrawn && account?.toLowerCase() !== entry.data.contributor.toLowerCase() && !view.data.reviewers.some((r, i) => r.toLowerCase() === account?.toLowerCase() && ((entry.data.approvals | entry.data.rejections) & (1 << i))) && <div className="review-actions"><button onClick={() => action('提交认可票…', async () => { await send('reviewContribution', [BigInt(entry.id), true]); await loadSeason(view.id) })}>认可贡献 ✓</button><button onClick={() => action('提交拒绝票…', async () => { await send('reviewContribution', [BigInt(entry.id), false]); await loadSeason(view.id) })}>不认可 ×</button></div>}{(entry.weight || 0n) > 0n && <div className="payout-row"><span>最终权重 {String(entry.weight)} / {String(view.data.totalWeight)}</span><span>可领取 {amount(entry.claimable || 0n)} {symbol} · Testnet</span></div>}</div></article>)}</div>
    {view.data.status === 0 && Date.now() / 1000 < Number(view.data.submissionEnd) && <form className="panel contribution-form" onSubmit={submitContribution}><span className="overline">ADD YOUR NAME</span><h2>写下你的贡献</h2><p>公开的作品或活动证据，让这一份帮助可以被社区看见。</p><label>贡献类别<select value={evidence.category} onChange={e => setEvidence({ ...evidence, category: Number(e.target.value) })}>{categories.map((x, i) => <option value={i} key={i}>{x} · 权重 {weights[i]}</option>)}</select></label><label>贡献标题<input required maxLength={120} value={evidence.title} onChange={e => setEvidence({ ...evidence, title: e.target.value })} placeholder="例如：完成第一篇中文上手指南"/></label><label>简短说明<textarea required rows={3} maxLength={1500} value={evidence.description} onChange={e => setEvidence({ ...evidence, description: e.target.value })}/></label><div className="grid-two"><label>公开证据链接<input required type="url" value={evidence.evidenceUrl} onChange={e => setEvidence({ ...evidence, evidenceUrl: e.target.value })} placeholder="https://"/></label><label>公开署名 <small>可选</small><input value={evidence.displayName} maxLength={80} onChange={e => setEvidence({ ...evidence, displayName: e.target.value })} placeholder="昵称"/></label></div><label className="check"><input type="checkbox" checked={evidence.consent} onChange={e => setEvidence({ ...evidence, consent: e.target.checked })}/><span>我有权公开这份材料，并同意在片尾显示昵称、证据链接和链上地址。</span></label><button className="primary" disabled={!!busy || !evidence.consent}>提交贡献 ↗</button></form>}
    <section className="ledger"><div className="section-head"><div><span className="overline">ONCHAIN PROOF</span><h2>公共账本</h2></div><a href={`${explorer}/address/${contract}`} target="_blank" rel="noreferrer">查看合约 ↗</a></div>{view.ledgerError && <p className="warning">{view.ledgerError}</p>}{view.ledger.length === 0 && <div className="empty">尚无锁定、打赏或领取事件。</div>}{view.ledger.map((x, i) => <a className="ledger-row" key={`${x.tx}-${i}`} href={`${explorer}/tx/${x.tx}`} target="_blank" rel="noreferrer"><span>{({ SeasonFinalized: '名单锁定', ContributionReviewed: '审核确认', TipReceived: '收到打赏', CreatorClaimed: '项目方领取', ContributorClaimed: '贡献者领取', SeasonClosed: '季结束' } as Record<string, string>)[x.name] || x.name}</span><span>{x.detail}</span><code>{shorten(x.tx)} ↗</code></a>)}</section></section>
    <aside className="side-column"><div className="panel support"><span className="overline">SUPPORT THE WORK</span><h2>支持这个作品<br/>也支持幕后的人。</h2><p>所有金额均为 Monad Testnet 测试币，没有现金价值。打赏只覆盖这一季在本应用内收到的款项。</p><div className="split-bar"><span style={{ width: `${100 - view.data.contributorBps / 100}%` }}/><span style={{ width: `${view.data.contributorBps / 100}%` }}/></div><div className="split-label"><span>项目方 {100 - view.data.contributorBps / 100}%</span><span>片尾贡献者 {view.data.contributorBps / 100}%</span></div><div className="stat"><span>累计打赏</span><strong>{amount(view.data.totalTips)} <small>{symbol} · Testnet</small></strong></div>{view.data.status === 1 && Date.now() / 1000 < Number(view.data.tipEnd) && <><label>打赏金额<input type="number" min="0" step={10 ** -decimals} value={tipAmount} onChange={e => setTipAmount(e.target.value)}/></label><button className="primary full" onClick={tip} disabled={!!busy}>确认分配并打赏 ↗</button><small>钱包将先授权 {symbol}（若需要），再签署打赏交易；需少量测试 MON 支付 gas。</small></>}{view.data.status === 0 && <p className="warning">审核结束且名单锁定后开放打赏。</p>}{view.creatorClaimable > 0n && <button className="outline full" onClick={() => action('领取项目方份额…', async () => { await send('claimCreator', [BigInt(view.id)]); await loadSeason(view.id) })}>领取项目方份额 · {amount(view.creatorClaimable)} {symbol}</button>}{view.myClaimable > 0n && account && <button className="outline full" onClick={() => action('领取贡献者份额…', async () => { await send('claimContributor', [BigInt(view.id), account]); await loadSeason(view.id) })}>领取我的片尾份额 · {amount(view.myClaimable)} {symbol}</button>}{view.data.status === 0 && Date.now() / 1000 >= Number(view.data.reviewEnd) && <button className="outline full" onClick={() => action('锁定名单…', async () => { await send('finalizeSeason', [BigInt(view.id)]); await loadSeason(view.id) })}>锁定片尾名单 ↗</button>}{view.data.status === 1 && Date.now() / 1000 >= Number(view.data.tipEnd) && <button className="outline full" onClick={() => action('关闭本季…', async () => { await send('closeSeason', [BigInt(view.id)]); await loadSeason(view.id) })}>结束本季并结清尾数 ↗</button>}</div><div className="panel rules"><span className="overline">THE PROMISE</span><h3>公开规则</h3><p>{view.stored?.content?.rules || '原始规则文案暂不可用；链上费率和审核人仍可核验。'}</p><dl><dt>项目方收款</dt><dd><a href={`${explorer}/address/${view.data.payoutAddress}`} target="_blank" rel="noreferrer">{shorten(view.data.payoutAddress)} ↗</a></dd><dt>投稿截止</dt><dd>{date(view.data.submissionEnd)}</dd><dt>审核截止</dt><dd>{date(view.data.reviewEnd)}</dd><dt>打赏截止</dt><dd>{date(view.data.tipEnd)}</dd><dt>审核人</dt><dd>{view.data.reviewers.map((x, i) => <a key={i} href={`${explorer}/address/${x}`} target="_blank" rel="noreferrer">{shorten(x)} ↗ </a>)}</dd><dt>内容哈希</dt><dd><code title={view.data.metadataHash}>{shorten(view.data.metadataHash)}</code></dd></dl><p className="muted">哈希可证明展示快照未被改动，不能单独证明贡献真实或权属。收入承诺不涵盖场外收入。</p></div></aside></div></>}</main>}

    <footer><div><strong>✳ 片尾字幕</strong><p>每一次被看见，都有一群人站在光外。</p></div><div><span>Built for Monad Metropolis · Testnet MVP</span><a href={contract && isAddress(contract) ? `${explorer}/address/${contract}` : 'https://hackathon.monad.xyz/tracks/social-culture'} target="_blank" rel="noreferrer">{configured ? '合约' : '黑客松赛道'} ↗</a></div></footer>
  </div>
}

function SeasonCard({ id, open }: { id: number; open: () => void }) {
  const [s, setS] = useState<{ data: ChainSeason; story?: Stored<Story> }>()
  useEffect(() => { if (!contract || !isAddress(contract)) return; publicClient.readContract({ address: contract, abi, functionName: 'getSeason', args: [BigInt(id)] }).then(async raw => { const data = raw as ChainSeason; setS({ data, story: await stored<Story>('season', id, data.metadataHash) }) }).catch(() => {}) }, [id])
  if (!s) return null
  return <article className="season-card" onClick={open}><div className="card-art" style={safeLink(s.story?.content?.coverUrl) ? { backgroundImage: `linear-gradient(#1114,#1119),url(${safeLink(s.story?.content?.coverUrl)})` } : undefined}><span>SEASON {String(id).padStart(2, '0')}</span><strong>{s.story?.content?.title || '原始材料暂不可用'}</strong><b>✳</b></div><div className="card-copy"><span className="badge">{stage(s.data)}</span><h3>{s.story?.content?.title || '原始材料暂不可用'}</h3><p>{s.story?.content?.story || '链上规则可查看，原始故事资料暂不可用。'}</p><div className="card-bottom"><span>{s.story?.content?.community || '内容待恢复'}</span><button>进入片尾 ↗</button></div></div></article>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
