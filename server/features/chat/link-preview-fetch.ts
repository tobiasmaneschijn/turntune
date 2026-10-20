import { Resolver } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { chatWebUrl } from '../../../shared/chat-link-preview.js'

export interface PreviewAddress { address: string; family: 4 | 6 }
export interface PreviewHttpResponse { status: number; headers: Record<string, string | undefined>; body: Buffer }
export type PreviewResolver = (hostname: string, signal: AbortSignal) => Promise<PreviewAddress[]>
export type PreviewTransport = (url: URL, address: PreviewAddress, signal: AbortSignal, maximumBytes: number) => Promise<PreviewHttpResponse>

const privateNetworks = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) privateNetworks.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const)
  privateNetworks.addSubnet(address, prefix, 'ipv6')
const globalIpv6 = new BlockList()
globalIpv6.addSubnet('2000::', 3, 'ipv6')

export function isPublicPreviewAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !privateNetworks.check(address, 'ipv4')
  if (family === 6) return globalIpv6.check(address, 'ipv6') && !privateNetworks.check(address, 'ipv6')
  return false
}

export function publicPreviewUrl(value: string): URL {
  const normalized = chatWebUrl(value)
  if (!normalized) throw new Error('Invalid preview URL')
  const url = new URL(normalized)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (url.port || host.endsWith('.') || !host.includes('.') && !isIP(host) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/.test(host) ||
      (isIP(host) && !isPublicPreviewAddress(host))) throw new Error('Non-public preview URL')
  url.hash = ''
  return url
}

const resolveAddresses: PreviewResolver = async (hostname, signal) => {
  if (signal.aborted) throw signal.reason
  const literal = hostname.replace(/^\[|\]$/g, '')
  const family = isIP(literal)
  if (family) return [{ address: literal, family: family as 4 | 6 }]
  const resolver = new Resolver({ timeout: 1_500, tries: 1 })
  const cancel = () => resolver.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const [ipv4, ipv6] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)])
    if (signal.aborted) throw signal.reason
    return [
      ...(ipv4.status === 'fulfilled' ? ipv4.value.map(address => ({ address, family: 4 as const })) : []),
      ...(ipv6.status === 'fulfilled' ? ipv6.value.map(address => ({ address, family: 6 as const })) : []),
    ]
  } finally { signal.removeEventListener('abort', cancel) }
}

/** The connection uses the exact address that passed policy, including after redirects. */
const requestPinned: PreviewTransport = (url, address, signal, maximumBytes) => new Promise((resolve, reject) => {
  const lookup: LookupFunction = (_hostname, _options, callback) => callback(null, address.address, address.family)
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
    agent: false, lookup, family: address.family, signal,
    headers: { 'User-Agent': 'turntune-LinkPreview/1.0', Accept: 'text/html,image/webp,image/png,image/jpeg,image/gif', 'Accept-Encoding': 'identity' },
  }, response => {
    response.once('error', reject)
    const headers = {
      'content-type': response.headers['content-type'], 'content-encoding': response.headers['content-encoding'],
      location: response.headers.location,
    }
    if (Number(response.headers['content-length'] || 0) > maximumBytes ||
        (headers['content-encoding'] && headers['content-encoding'] !== 'identity')) {
      response.destroy(new Error('Preview response is too large or encoded'))
      return
    }
    let size = 0
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maximumBytes) response.destroy(new Error('Preview response is too large'))
      else chunks.push(chunk)
    })
    response.once('end', () => resolve({ status: response.statusCode || 0, headers, body: Buffer.concat(chunks) }))
  })
  request.setTimeout(2_500, () => request.destroy(new Error('Preview request timed out')))
  request.once('error', reject)
  request.end()
})

export function createPublicPreviewFetcher(dependencies: { resolve?: PreviewResolver; request?: PreviewTransport } = {}) {
  const resolve = dependencies.resolve || resolveAddresses
  const request = dependencies.request || requestPinned
  return async (value: string, signal: AbortSignal, maximumBytes: number): Promise<PreviewHttpResponse & { url: URL }> => {
    let url = publicPreviewUrl(value)
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (signal.aborted) throw signal.reason
      const addresses = await resolve(url.hostname, signal)
      if (!addresses.length || addresses.some(item => !isPublicPreviewAddress(item.address))) throw new Error('Non-public preview address')
      if (signal.aborted) throw signal.reason
      const result = await request(url, addresses[0], signal, maximumBytes)
      if (result.body.length > maximumBytes) throw new Error('Preview response is too large')
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (redirects === 3 || !result.headers.location) throw new Error('Too many preview redirects')
        url = publicPreviewUrl(new URL(result.headers.location, url).href)
        continue
      }
      return { ...result, url }
    }
    throw new Error('Preview is unavailable')
  }
}
