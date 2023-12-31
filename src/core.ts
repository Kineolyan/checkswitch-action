import * as core from '@actions/core'
import * as github from '@actions/github'

type GithubConfig = Readonly<{
  githubToken: string
}>

type LabelConfig = Readonly<{
  captureLabels: boolean
}>

type NamespaceConfig = Readonly<{
  namespace?: string
}>

export type Config = Readonly<{
  delay: number
}> &
  NamespaceConfig &
  LabelConfig &
  GithubConfig

export type Report = Readonly<{
  hasChanged: boolean
  state: Record<string, boolean>
  changed: Readonly<string[]>
  captures?: Record<string, string>
}>

export type PrInfo = Readonly<{
  owner: string
  repo: string
  prNumber: number
  body: string
}>

type SwitchInfo = Readonly<{
  id: string
  before: boolean
  after: boolean
  capture: string
  namespace?: string
}>

function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined
}

const buildOctokit = ({ githubToken: token }: GithubConfig) => {
  // You can also pass in additional options as a second parameter to getOctokit
  // const octokit = github.getOctokit(myToken, {userAgent: "MyActionVersion1"});
  return github.getOctokit(token)
}

export async function getPrInfo(config: GithubConfig): Promise<PrInfo> {
  core.debug('Fetching pull-request information')
  const octokit = buildOctokit(config)

  const owner = github.context.repo.owner
  const repo = github.context.repo.repo
  const prNumber = parseInt(github.context.payload?.number, 10)
  core.debug(`Fetching info on pull-request ${owner}/${repo}#${prNumber}`)
  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber
  })
  core.debug('Pull-request info fetched with success')
  return {
    owner,
    repo,
    prNumber,
    body: pullRequest.body ?? ''
  }
}

const isEnabled = (checkChar: string) => checkChar !== ' '

const findSwitch = (line: string): SwitchInfo | null => {
  const pattern =
    /^\s*- \[( |x|X)\](.*?)<!-- (?:([a-zA-Z0-9\-_]+)\/)?([a-zA-Z0-9\-_]+) state\[( |x|X)\] -->\s*$/
  const match = pattern.exec(line)
  if (match) {
    const [, after, capture, namespace, id, before] = match
    return {
      id: id.trim(),
      before: isEnabled(before),
      after: isEnabled(after),
      capture: capture.trim(),
      namespace
    }
  } else {
    return null
  }
}

const belongToNamespace = ({
  config: { namespace: spec },
  switchInfo: { namespace }
}: Readonly<{ config: NamespaceConfig; switchInfo: SwitchInfo }>) =>
  spec === namespace

export function process({
  body: prBody,
  config
}: Readonly<{ body: string; config: Config }>): Report {
  core.debug(`Processing body <<<
  ${prBody}
  >>>`)
  const lines = prBody.split('\n')
  const switches = lines
    .map(line => findSwitch(line))
    .filter(notEmpty)
    .filter(found => belongToNamespace({ config, switchInfo: found }))

  const changed = switches
    .filter(({ before, after }) => before !== after)
    .map(info => info.id)
  changed.sort()
  const state = switches.reduce(
    (acc, { id, after }) => {
      acc[id] = after
      return acc
    },
    {} as Record<string, boolean>
  )
  const output = {
    hasChanged: changed.length > 0,
    state,
    changed
  }
  if (config.captureLabels) {
    const captures = switches.reduce(
      (acc, { id, capture }) => {
        acc[id] = capture
        return acc
      },
      {} as Record<string, string>
    )
    return { ...output, captures }
  } else {
    return output
  }
}

const rewritePrLine = (line: string, { after, before }: SwitchInfo) => {
  if (before !== after) {
    const i = line.lastIndexOf('state[')
    const end = line.indexOf(']', i)
    const newState = after ? 'x' : ' '
    return `${line.substring(0, i)}state[${newState}]${line.substring(end + 1)}`
  } else {
    return line
  }
}

export function rewritePrBody(content: string): string {
  return content
    .split('\n')
    .map(line => {
      const switchDetails = findSwitch(line)
      return switchDetails === null ? line : rewritePrLine(line, switchDetails)
    })
    .join('\n')
}

export async function updatePr({
  pr: { owner, repo, prNumber, body },
  config
}: Readonly<{ pr: PrInfo; config: GithubConfig }>): Promise<void> {
  core.debug(`Rewriting pull-request body`)
  const newBody = rewritePrBody(body)
  const octokit = buildOctokit(config)

  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    body: newBody
  })
  core.debug(`Pull-request body updated`)
}
