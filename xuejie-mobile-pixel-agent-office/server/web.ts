import {lookup} from 'node:dns/promises';
import {isIP, BlockList} from 'node:net';
import {fetch, EnvHttpProxyAgent, type Dispatcher} from 'undici';
import {load} from 'cheerio';
import {ProviderError} from './provider';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) blocked.addSubnet(address,prefix,'ipv4');
export function publicAddress(address: string) {
 if (isIP(address) === 4) return !blocked.check(address, 'ipv4');
 // Only global unicast IPv6; excludes loopback, local, mapped IPv4 and documentation space.
 if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
 return false;
}
type Resolver = (host: string) => Promise<{address: string}[]>;
export async function publicUrl(value: string, resolver: Resolver = host => lookup(host, {all:true})) {
 let url: URL; try {url = new URL(value);} catch {throw new ProviderError('INVALID_URL', '请提供有效的公开 HTTPS 网页链接。');}
 if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || !url.hostname.includes('.') || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) throw new ProviderError('INVALID_URL', '仅支持公开 HTTPS 网页，不支持本地网络、凭据或其他端口。');
 let addresses: {address: string}[]; const host = url.hostname.replace(/^\[|\]$/g, '');
 try {addresses = isIP(host) ? [{address: host}] : await resolver(host);} catch {throw new ProviderError('WEB_DNS', '网页域名无法解析。');}
 if (!addresses.length || addresses.some(value => !publicAddress(value.address))) throw new ProviderError('PRIVATE_URL', '网页工具不能访问本地、私有或保留网络地址。');
 url.hash = ''; return url;
}
export class WebReader {
 constructor(private dispatcher: Dispatcher = new EnvHttpProxyAgent(), private resolver?: Resolver) {}
 async read(value: string) {
  const signal = AbortSignal.timeout(15000); let url = await publicUrl(value, this.resolver);
  try {
   for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {dispatcher:this.dispatcher, redirect:'manual', signal, headers:{Accept:'text/html, text/plain', 'User-Agent':'XuejieMobileAgent/1.0'}});
    if ([301,302,303,307,308].includes(response.status)) {
     await response.body?.cancel(); const location=response.headers.get('location');
     if (!location || redirects===3) throw new ProviderError('WEB_REDIRECT','网页重定向过多或无效。');
     url = await publicUrl(new URL(location, url).href, this.resolver); continue;
    }
    if (!response.ok) {await response.body?.cancel(); throw new ProviderError('WEB_HTTP',`网页返回 HTTP ${response.status}，未成功读取。`);}
    const type = response.headers.get('content-type') ?? '';
    if (!/^(text\/html|text\/plain)(;|$)/i.test(type)) {await response.body?.cancel(); throw new ProviderError('WEB_FORMAT','只读取公开 HTML 或纯文本网页；文件请上传。');}
    if (Number(response.headers.get('content-length') ?? 0) > 2*1024*1024) {await response.body?.cancel();throw new ProviderError('WEB_SIZE','网页超过 2 MB 读取上限。');}
    let size=0; const chunks:Uint8Array[]=[];
    for await (const chunk of response.body!) {size+=chunk.length; if(size>2*1024*1024)throw new ProviderError('WEB_SIZE','网页超过 2 MB 读取上限。'); chunks.push(chunk);}
    const html=Buffer.concat(chunks).toString('utf8'); let title=url.hostname, content=html;
    if (/text\/html/i.test(type)) {
     const $=load(html); title=$('title').first().text().trim()||title;
     $('script,style,noscript,iframe,svg,form,nav,footer,header').remove();
     $('br').replaceWith('\n'); $('p,li,h1,h2,h3,h4,tr,div,section').append('\n');
     content=($('main').length?$('main'): $('article').length?$('article'):$('body')).text();
    }
    content=content.replace(/[\t ]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
    if (!content) throw new ProviderError('WEB_EMPTY','网页没有可读取的正文，可能需要登录或 JavaScript。');
    return {url:url.href,title:title.slice(0,200),text:content.slice(0,10000),totalCharacters:content.length,truncated:content.length>10000,fetchedAt:new Date().toISOString()};
   }
   throw new ProviderError('WEB_REDIRECT','网页重定向失败。');
  } catch (e) {if(e instanceof ProviderError)throw e; throw new ProviderError('WEB_NETWORK',signal.aborted?'网页读取超时。':'网页连接失败。');}
 }
}
