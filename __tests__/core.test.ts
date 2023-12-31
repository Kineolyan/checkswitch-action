import { process, rewritePrBody, Config } from '../src/core'
import { expect } from '@jest/globals'

const cfg: Config = {
  githubToken: 'UNUSED',
  delay: 0,
  captureLabels: false
}

describe('process', () => {
  it('finds a single switch', () => {
    const body = `
        PR body
         - [ ] run operation <!-- run-operation state[x] -->
    `
    const report = process({ body, config: cfg })

    expect(report).toEqual({
      hasChanged: true,
      state: {
        'run-operation': false
      },
      changed: ['run-operation']
    })
  })

  it('finds multiple switches', () => {
    const body = `
        PR body
         - [ ] do some random task<!-- do-something state[ ] -->                
         - [x] operate <!-- operate state[x] --> 
    `
    const report = process({ body, config: cfg })

    expect(report).toEqual({
      hasChanged: false,
      state: {
        'do-something': false,
        operate: true
      },
      changed: []
    })
  })

  it('finds multiple switches with many changes', () => {
    const body = `
        PR body
         - [ ] operate <!-- operate state[x] --> 
         - [x] do some random task<!-- do-something state[ ] -->                
    `
    const report = process({ body, config: cfg })

    expect(report).toEqual({
      hasChanged: true,
      state: {
        'do-something': true,
        operate: false
      },
      // Ensure that the output is in alphabetical order
      changed: ['do-something', 'operate']
    })
  })

  it('ignores badly-formatted lines', () => {
    const body = `
        PR body
         - [ ] do some random task<!-- too many words before state[ ] -->                
         - [] not enough space in checkbox <!-- operate state[x] --> 
         - [  ] too many spaces in checkbox <!-- operate state[x] --> 
          - [y] not the correct checkbox char <!-- operate state[x] --> 
         - [ ] not enough space in checkbox <!-- operate state[] --> 
         - [ ] too many spaces in checkbox <!-- operate state[  ] --> 
         - [ ] not the correct checkbox char <!-- operate state[v] --> 
         - [x] missing id <!-- state[x] --> 
         - [x] id after state <!-- state[x] id-after-state --> 
         - [x] line with extra content in the comment <!-- id-after-state state[x] and more --> 
         - [x] line with content after the comment <!-- id-after-st state[x] --> but followed
    `
    const report = process({ body, config: cfg })

    const expectedReport = {
      hasChanged: false,
      state: {},
      changed: []
    }
    expect(report).toEqual(expectedReport)
  })

  it('finds switches and labels', () => {
    const body = `
        PR body
         - [ ] do some random task<!-- do-something state[ ] -->                
         - [x]    operate   <!-- operate state[x] --> 
    `
    const report = process({ body, config: { ...cfg, captureLabels: true } })

    expect(report).toEqual({
      hasChanged: false,
      state: {
        'do-something': false,
        operate: true
      },
      captures: {
        'do-something': 'do some random task',
        operate: 'operate'
      },
      changed: []
    })
  })

  it('filters switches with a given namespace', () => {
    const body = `
      Switches for CI
      -------
      
      - [x] Run tests in a fancy CI system <!-- fancy-test state[ ] -->
      - [ ] Update changelog <!-- update-changelog state[ ] -->
      
      Validation switches
      -------
      
      - [x] Lint: required <!-- validation/lint state[ ] -->
      - [x] Format: required <!-- validation/format state[ ] -->
    `
    const report = process({
      body,
      config: { ...cfg, namespace: 'validation' }
    })

    expect(report).toEqual({
      hasChanged: true,
      state: {
        lint: true,
        format: true
      },
      changed: ['format', 'lint']
    })
  })

  it('filters switches without any given namespace', () => {
    const body = `
      Switches for CI
      -------
      
      - [x] Run tests in a fancy CI system <!-- fancy-test state[ ] -->
      - [ ] Update changelog <!-- update-changelog state[ ] -->
      
      Validation switches
      -------
      
      - [x] Lint: required <!-- validation/lint state[ ] -->
      - [x] Format: required <!-- validation/format state[ ] -->
    `
    const report = process({ body, config: cfg })

    expect(report).toEqual({
      hasChanged: true,
      state: {
        'fancy-test': true,
        'update-changelog': false
      },
      changed: ['fancy-test']
    })
  })

  it('detect changes only in the considered namespaced switches', () => {
    const body = `
      Switches for CI
      -------
      
      - [x] Run tests in a fancy CI system <!-- fancy-test state[ ] -->
      - [ ] Update changelog <!-- update-changelog state[ ] -->
      
      Validation switches
      -------
      
      - [ ] Lint: required <!-- validation/lint state[ ] -->
      - [x] Format: required <!-- validation/format state[x] -->
    `
    const unnamedReport = process({ body, config: cfg })
    const validationReport = process({
      body,
      config: { ...cfg, namespace: 'validation' }
    })

    expect(unnamedReport.hasChanged).toBeTruthy()
    expect(validationReport.hasChanged).toBeFalsy()
  })
})

describe('rewritePrBody', () => {
  it('does not rewrite unchanged unchecked line', () => {
    const output = rewritePrBody(`
       - [ ] run operation <!-- run-operation state[ ] -->
    `)
    expect(output).toEqual(`
       - [ ] run operation <!-- run-operation state[ ] -->
    `)
  })

  it('does not rewrite unchanged checked line', () => {
    const output = rewritePrBody(`
       - [x] run operation <!-- run-operation state[x] -->
    `)
    expect(output).toEqual(`
       - [x] run operation <!-- run-operation state[x] -->
    `)
  })

  it('rewrites changed unchecked line', () => {
    const output = rewritePrBody(`
       - [ ] run operation <!-- run-operation state[x] -->
    `)
    expect(output).toEqual(`
       - [ ] run operation <!-- run-operation state[ ] -->
    `)
  })

  it('rewrites changed checked line', () => {
    const output = rewritePrBody(`
       - [x] run operation <!-- run-operation state[ ] -->
    `)
    expect(output).toEqual(`
       - [x] run operation <!-- run-operation state[x] -->
    `)
  })

  it('can rewrite multiple lines', () => {
    const output = rewritePrBody(`
        PR body
        

        and multiple blocks
        __________________
        
         - [ ] on to off <!-- on-to-off state[x] -->                
         - [x] on to on <!-- on-to-on state[x] -->                
         - [ ] off to off <!-- off-to-off state[ ] -->                
         - [x] off to on <!-- off-to-on state[ ] -->                
         
        And we find something after,
        across multiple lines
    `)
    expect(output).toEqual(`
        PR body
        

        and multiple blocks
        __________________
        
         - [ ] on to off <!-- on-to-off state[ ] -->                
         - [x] on to on <!-- on-to-on state[x] -->                
         - [ ] off to off <!-- off-to-off state[ ] -->                
         - [x] off to on <!-- off-to-on state[x] -->                
         
        And we find something after,
        across multiple lines
    `)
  })
})
