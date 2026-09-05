import fs from 'node:fs/promises';
import path from 'node:path';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Metadata } from 'next';
export const metadata: Metadata = {title: 'Real data & training guide · ThermoScan'};
export default async function Guide(){
  const content=await fs.readFile(path.join(process.cwd(),'docs/HISTORICAL_DATA.md'),'utf8');
  return <main className="mx-auto max-w-4xl px-6 py-10"><div className="mb-8 flex items-center justify-between"><a href="/" className="flex items-center gap-2 font-display text-lg font-semibold"><img src="/icon.svg" width={32} height={32} alt=""/>ThermoScan<span className="text-ember">.</span></a><a href="/" className="btn-secondary">← Back to workspace</a></div><article className="guide-content panel p-6 sm:p-10"><Markdown remarkPlugins={[remarkGfm]} components={{a:({href,children})=><a href={href} target={href?.startsWith('http')?'_blank':undefined} rel="noopener noreferrer">{children}</a>}}>{content}</Markdown></article><div className="mt-6 text-center text-xs text-muted">Original measurements. Reproducible methods. Visible limitations.</div></main>;
}
