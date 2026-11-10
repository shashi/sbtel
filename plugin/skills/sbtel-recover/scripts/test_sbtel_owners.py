#!/usr/bin/env python3
"""Tests for sbtel_owners.py and sbtel_sccs.py (standard library only).

  python3 plugin/skills/sbtel-recover/scripts/test_sbtel_owners.py      (make test-all runs it)

They cover every annotation form of docs/DESIGN.md section 8: `@sbtel Name`, `begin`/`end`, `file`,
and the two anchors `message Name` and `port Block.port`, plus the errors and --edges; and the SCCs and
levels that sbtel_sccs.py finds.
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'sbtel_owners.py')
sys.dont_write_bytecode = True  # no __pycache__ in the plugin directory
sys.path.insert(0, HERE)
import sbtel_owners as so  # noqa: E402
import sbtel_sccs as sc  # noqa: E402

SPEC = '''
(block App
  (shape Req (sketch "A request."))
  (shape Reply)
  (behavior Logs (gives Req :as log))
  (level (block App.Ui (gives Req :as submit) (takes Reply :as done)) (block App.Api (implements Logs) (takes Req)))
  (level (block App.Store)))
'''


def run_owners(files, stdin=None):
    """Write SPEC and files into a temp dir, run the script there; return (code, stdout, stderr)."""
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, 'spec.sbtel'), 'w', encoding='utf-8') as f:
            f.write(SPEC)
        for name, text in files.items():
            with open(os.path.join(d, name), 'w', encoding='utf-8') as f:
                f.write(text)
        args = [sys.executable, '-I', SCRIPT, 'spec.sbtel'] + list(files) + (['--edges'] if stdin is not None else [])
        p = subprocess.run(args, cwd=d, input=stdin or '', capture_output=True, text=True)
        return p.returncode, p.stdout, p.stderr


def ranges(stdout):
    return [tuple(l.split('\t')) for l in stdout.splitlines()]


class SpecReading(unittest.TestCase):
    def test_spec(self):
        sp = so.read_spec(SPEC)
        self.assertEqual(sp.blocks, {'App', 'App.Ui', 'App.Api', 'App.Store'})
        self.assertEqual(sp.containers, {'App'})
        self.assertEqual(sp.messages, {'Req', 'Reply'})
        self.assertEqual(sp.ports['App.Ui'], {'submit', 'done'})
        self.assertEqual(sp.ports['App.Api'], {'req', 'log'})  # own + implemented behavior's
        self.assertEqual(sp.ports['App.Store'], set())

    def test_tilde_sketches(self):
        # (~ ~) sketches hide everything inside, quotes, parens and ~) included (more tildes on both ends).
        sp = so.read_spec('(block A (~~ (block Fake) "q ; ~) x ~~) (level :name "L" (~~ a ~) (block Nope ~~) (block B (takes M :as p (~ (takes M :as q) ~)))))')
        self.assertEqual(sp.blocks, {'A', 'B'})
        self.assertEqual(sp.ports['B'], {'p'})


class Forms(unittest.TestCase):
    def test_file_name_and_region(self):
        code, out, err = run_owners({'ui.js': (
            '// @sbtel file App.Ui\n'
            'import x from "y";\n'
            '\n'
            '// @sbtel App.Api\n'
            'function handler(req) {\n'
            '  return 1;\n'
            '}\n'
            '// @sbtel begin App.Store\n'
            'const cache = new Map();\n'
            '// @sbtel end App.Store\n'
            'render();\n')})
        self.assertEqual(err, '')
        self.assertEqual(code, 0)
        self.assertEqual(ranges(out), [('ui.js', '1', '4', 'App.Ui'), ('ui.js', '5', '7', 'App.Api'),
                                       ('ui.js', '8', '9', 'App.Store'), ('ui.js', '10', '12', 'App.Ui')])  # the last, empty line too

    def test_python_decorator_and_nested_regions(self):
        code, out, err = run_owners({'s.py': (
            '# @sbtel file App.Store\n'
            '# @sbtel App.Api\n'
            '@route\n'
            'def f():\n'
            '    return 1\n'
            '# @sbtel begin App.Ui\n'
            'a = 1\n'
            '# @sbtel begin App.Api\n'
            'b = 2\n'
            '# @sbtel end App.Api\n'
            'c = 3\n'
            '# @sbtel end App.Ui\n'
            'd = 4\n')})
        self.assertEqual((code, err), (0, ''))
        # An annotation line belongs to the owner in effect after it: `@sbtel App.Api` (line 2) is still
        # App.Store's, and the declaration starts at its decorator.
        self.assertEqual(ranges(out), [('s.py', '1', '2', 'App.Store'), ('s.py', '3', '5', 'App.Api'),
                                       ('s.py', '6', '7', 'App.Ui'), ('s.py', '8', '9', 'App.Api'),
                                       ('s.py', '10', '11', 'App.Ui'), ('s.py', '12', '14', 'App.Store')])

    def test_comment_styles(self):
        for text in ('-- @sbtel file App.Ui\nselect 1;\n', '<!-- @sbtel file App.Ui -->\n<p>x</p>\n',
                     '/* @sbtel file App.Ui */\nint x;\n', '; @sbtel file App.Ui\n(x)\n', "' @sbtel file App.Ui\nx = 1\n",
                     '% @sbtel file App.Ui\nx\n'):
            code, out, err = run_owners({'f.txt': text})
            self.assertEqual((code, err), (0, ''), text)
            self.assertEqual(ranges(out), [('f.txt', '1', '3', 'App.Ui')], text)

    def test_not_in_a_comment(self):
        code, out, err = run_owners({'f.js': '// @sbtel file App.Ui\nconst s = "@sbtel file App.Api";\n'})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('f.js', '1', '3', 'App.Ui')])


class Anchors(unittest.TestCase):
    def test_message_anchor_owns_no_code(self):
        code, out, err = run_owners({'m.js': (
            '// @sbtel file App.Ui\n'
            '// @sbtel message Req\n'
            'const Req = {};\n'
            '/* @sbtel message Reply */\n'
            'const Reply = {};\n')})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('m.js', '1', '6', 'App.Ui')])

    def test_port_names_v03(self):
        # sbtel 0.3: (takes Type [:as name]); the name defaults to the type's, first letter lowercased.
        self.assertEqual([so.default_port_name(k) for k in ('NoteSaved', 'URL', 'shell.Intent', 'pkg::Item', 'List<Item>', 'T')],
                         ['noteSaved', 'uRL', 'intent', 'item', 'list', 't'])
        sp = so.read_spec('(shape Item) (block A (takes Item) (gives Item :as feed (~ x ~)) (port old in Item))')
        self.assertEqual(sp.ports['A'], {'item', 'feed', 'old'})

    def test_port_anchor_owns_no_code(self):
        code, out, err = run_owners({'p.js': (
            '// @sbtel file App.Ui\n'
            '// @sbtel port App.Ui.submit\n'
            'function submit() {}\n'
            '// @sbtel port App.Api.log\n'      # a port the block gets from an implemented behavior
            'function log() {}\n')})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('p.js', '1', '6', 'App.Ui')])

    def test_anchor_between_name_and_declaration(self):
        # As in core/core.js: `@sbtel MessageIndex` then `@sbtel message MessageRows` then the code.
        code, out, err = run_owners({'a.js': (
            '// @sbtel file App.Ui\n'
            '// @sbtel App.Api\n'
            '// @sbtel message Req\n'
            '// @sbtel port App.Api.req\n'
            'function handle(req) {\n'
            '  return req;\n'
            '}\n'
            'after();\n')})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('a.js', '1', '4', 'App.Ui'), ('a.js', '5', '7', 'App.Api'), ('a.js', '8', '9', 'App.Ui')])

    def test_anchor_inside_region_keeps_region(self):
        code, out, err = run_owners({'r.js': (
            '// @sbtel begin App.Store\n'
            '// @sbtel message Req\n'
            'x();\n'
            '// @sbtel end App.Store\n')})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('r.js', '1', '3', 'App.Store')])

    def test_anchor_errors(self):
        code, _, err = run_owners({'e.js': (
            '// @sbtel file App.Ui\n'
            '// @sbtel message Nope\n'
            '// @sbtel port App.Ui.nope\n'
            '// @sbtel port Missing.x\n'
            '// @sbtel port nodot\n'
            '// @sbtel message\n'
            '// @sbtel port App.Store.req extra\n'
            'x();\n')})
        self.assertEqual(code, 1)
        self.assertEqual(err.splitlines(), [
            'e.js:2: unknown shape Nope',
            'e.js:3: block App.Ui has no port nope',
            'e.js:4: unknown block Missing',
            'e.js:5: port anchor needs Block.port: nodot',
            'e.js:6: unknown block or behavior message',
            'e.js:7: not one of the annotation forms (Name, begin Name, end Name, file Name, shape Name, '
            'port Block.port): port App.Store.req extra',
        ])

    def test_anchors_alone_leave_code_unowned(self):
        code, _, err = run_owners({'u.js': '// @sbtel message Req\nconst Req = 1;\n'})
        self.assertEqual(code, 1)
        self.assertEqual(err, 'u.js:2: code in no block\n')


class Errors(unittest.TestCase):
    def test_region_and_ownership_errors(self):
        code, _, err = run_owners({'b.go': (
            'package b // @sbtel file App\n'
            '// @sbtel begin App.Nope\n'
            '// @sbtel end App.Ui\n'
            '// @sbtel end App.Api\n'
            '// @sbtel begin App.Store\n'
            'func x() {}\n')})
        self.assertEqual(code, 1)
        # Annotation errors in line order, then regions never ended, then ownership errors.
        self.assertEqual(err.splitlines(), [
            'b.go:2: unknown block or behavior App.Nope',
            'b.go:3: end App.Ui does not match begin App.Nope (line 2)',
            'b.go:4: end App.Api without begin',
            'b.go:5: begin App.Store never ended',
        ])

    def test_container_and_unowned_code(self):
        code, _, err = run_owners({'c.go': 'package c\n// @sbtel file App\nfunc a() {}\nfunc b() {}\n'})
        self.assertEqual(code, 1)
        self.assertEqual(err.splitlines(), ['c.go:1: code in no block',
                                            'c.go:3-4: code owned by container block App (code belongs to leaf blocks)'])

    def test_long_form_is_gone(self):
        code, _, err = run_owners({'l.js': '// @sbtel (owns App.Ui)\nx();\n'})
        self.assertEqual(code, 1)
        self.assertIn('l.js:1: not one of the annotation forms (Name, begin Name, end Name, file Name, shape Name, '
                      'port Block.port): (owns App.Ui)', err)


class Edges(unittest.TestCase):
    # From the Go recovery review (fresh2/repro): x.go, w.go, st.go, z.go.
    def test_raw_string_at_column_0_stays_in_its_declaration(self):
        go = ('// @sbtel file App.Ui\npackage x\n\n// @sbtel App.Api\nvar usage = `first line\n'
              'second line at column 0\n}\n`\n\nfunc after() {}\n')
        code, out, err = run_owners({'x.go': go})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('x.go', '1', '4', 'App.Ui'), ('x.go', '5', '8', 'App.Api'), ('x.go', '9', '11', 'App.Ui')])
        py = ('# @sbtel file App.Ui\ndef f():\n    # @sbtel App.Api\n    def g():\n        return """\nat column 0\n"""\n    return 1\n')
        code, out, err = run_owners({'x.py': py})
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(ranges(out), [('x.py', '1', '3', 'App.Ui'), ('x.py', '4', '7', 'App.Api'), ('x.py', '8', '9', 'App.Ui')])

    def test_annotation_inside_a_string_is_not_one(self):
        go = ('// @sbtel file App.Ui\npackage x\n\nvar s = "// @sbtel file Nope"\nvar t = `\n// @sbtel Nope\n`\n'
              "var r = '#' // @sbtel App.Api\n")
        code, out, err = run_owners({'w.go': go})
        self.assertEqual((code, err), (0, ''))  # "Nope" would be an unknown block if it were read
        self.assertEqual(ranges(out), [('w.go', '1', '9', 'App.Ui')])  # line 8's @sbtel App.Api: pending, no declaration after it

    def test_stacked_names_and_two_file_annotations_are_errors(self):
        code, _, err = run_owners({'st.go': '// @sbtel file App.Ui\npackage x\n\n// @sbtel App.Ui\n// @sbtel App.Api\nfunc f() {}\n'})
        self.assertEqual(code, 1)
        self.assertIn('st.go:5: a second @sbtel App.Api for the same declaration (after @sbtel App.Ui): one per declaration', err)
        code, _, err = run_owners({'z.go': '// @sbtel file App.Ui\n// @sbtel file App.Api\npackage x\n'})
        self.assertEqual(code, 1)
        self.assertIn('z.go:2: a second @sbtel file (the first is on line 1): one per file', err)

    def test_edges(self):
        files = {'ui.js': '// @sbtel file App.Ui\nimport s from "./s.js";\ns.save();\n',
                 's.js': '// @sbtel file App.Store\n// @sbtel message Req\nexport function save() {}\n'}
        code, out, err = run_owners(files, stdin='ui.js:2 s.js:1\nui.js:3 s.js:3\nui.js:3 s.js:3\nui.js:2 ui.js:3\nbad line\nui.js:9 s.js:1\n')
        self.assertEqual(code, 1)
        self.assertEqual(out, 'App.Ui -> App.Store  # ui.js:2\nApp.Ui -> App.Store  # ui.js:3\n')
        self.assertEqual(err, 'stdin: not a "file:line file:line" pair: bad line\nui.js:9 -> s.js:1: no owner for caller\n')


# Dependency inversion (sbtel 0.2.2): an interface owned by a behavior, an implementer, a caller that
# calls only through the interface, and a composition root that builds the implementer and hands it over.
INV_SPEC = '''
(shape Line)
(behavior Durable :type "interface" (takes Line :as save))
(behavior Journaled :type "interface" (implements Durable))
(behavior Tools (sketch "A behavior with a block's name."))
(block Inv
  (level (block Inv.Root))
  (level (block Inv.Editor))
  (level (block Inv.Disk (implements Journaled)) (block Inv.Mem)))
(block Tools)
'''
# The same program in Go (store.go, editor.go, main.go) as sbtel_refs_go prints its references, and in
# TypeScript (store.ts, ...) as sbtel_refs.mjs does: a blank assertion and an embedded interface, or the
# heritage clauses, are tagged `implements`.
INV_GO = {
    'store.go': ('// @sbtel Durable\ntype Durable interface {\n\tSave(s string) error\n}\n\n'
                 '// @sbtel Journaled\ntype Journaled interface {\n\tDurable\n\tReplay() []string\n}\n\n'
                 '// @sbtel begin Inv.Disk\ntype Disk struct{ lines []string }\n\nvar _ Journaled = (*Disk)(nil)\n'
                 '// @sbtel end Inv.Disk\n\n// @sbtel Inv.Mem\ntype Mem struct{}\n\n'
                 '// @sbtel Inv.Mem\nvar _ Durable = Mem{}\n'),
    'editor.go': '// @sbtel file Inv.Editor\ntype Editor struct{ out Durable }\n\nfunc (e *Editor) Type(s string) error { return e.out.Save(s) }\n',
    'main.go': '// @sbtel file Inv.Root\nfunc main() { (&Editor{out: &Disk{}}).Type("hi") }\n',
}
INV_GO_REFS = (
    'store.go:8 store.go:2\tDurable\timplements\n'      # Journaled embeds Durable: Journaled implements Durable
    'store.go:15 store.go:7\tJournaled\timplements\n'   # var _ Journaled = (*Disk)(nil)
    'store.go:15 store.go:13\tDisk\n'
    'store.go:22 store.go:2\tDurable\timplements\n'     # var _ Durable = Mem{}: the spec does not say so
    'editor.go:2 store.go:2\tDurable\n'                  # a field of the interface type: a use
    'editor.go:4 store.go:3\tSave\n'                     # a call through the interface: a use
    'main.go:2 editor.go:2\tEditor\n'
    'main.go:2 store.go:13\tDisk\n'                      # the composition root names the implementer
)
INV_TS = {
    'store.ts': ('// @sbtel Durable\ninterface Durable { save(s: string): void; }\n'
                 '// @sbtel Journaled\ninterface Journaled extends Durable { replay(): string[]; }\n'
                 '// @sbtel Inv.Disk\nclass Disk implements Journaled { save(s: string) {} replay() { return []; } }\n'),
    'editor.ts': '// @sbtel file Inv.Editor\nfunction type(out: Durable) { out.save("hi"); }\n',
    'main.ts': '// @sbtel file Inv.Root\ntype(new Disk());\n',
}
INV_TS_REFS = (
    'store.ts:4 store.ts:2\tDurable\timplements\n'
    'store.ts:6 store.ts:4\tJournaled\timplements\n'
    'editor.ts:2 store.ts:2\tDurable\n'
    'editor.ts:2 store.ts:2\tsave\n'
    'main.ts:2 editor.ts:2\ttype\n'
    'main.ts:2 store.ts:6\tDisk\n'
)


def run_inv(files, stdin=None):
    global SPEC
    keep, SPEC = SPEC, INV_SPEC
    try:
        return run_owners(files, stdin)
    finally:
        SPEC = keep


class Behaviors(unittest.TestCase):
    def test_spec_reads_behaviors_and_extension(self):
        sp = so.read_spec(INV_SPEC + '(behavior (Store T) (takes T :as put)) (block P (implements (Store Line)))')
        self.assertEqual(sp.behaviors, {'Durable', 'Journaled', 'Tools', 'Store'})
        self.assertEqual(sp.implemented('Inv.Disk'), {'Journaled', 'Durable'})  # through Journaled
        self.assertEqual(sp.implemented('beh:Journaled'), {'Durable'})
        self.assertEqual(sp.ports['Inv.Disk'], {'save'})
        self.assertEqual(sp.ports['P'], {'put'})
        self.assertEqual((sp.resolve('Tools'), sp.resolve('beh:Tools'), sp.resolve('Durable'), sp.resolve('Nope')),
                         ('Tools', 'beh:Tools', 'beh:Durable', None))

    def test_ranges_name_behaviors(self):
        code, out, err = run_inv(INV_GO)
        self.assertEqual(err.splitlines(), [])
        self.assertIn(('store.go', '2', '4', 'beh:Durable'), ranges(out))
        self.assertIn(('store.go', '7', '10', 'beh:Journaled'), ranges(out))

    def test_go_edges(self):
        code, out, err = run_inv(INV_GO, INV_GO_REFS)
        # The caller binds only the behavior; the root binds the caller and the implementer; the tagged
        # references are no bindings, and the one the spec lacks is an error.
        self.assertEqual(out.splitlines(), [
            'Inv.Editor -> Durable  # editor.go:2',
            'Inv.Editor -> Durable  # editor.go:4',
            'Inv.Root -> Inv.Editor  # main.go:2',
            'Inv.Root -> Inv.Disk  # main.go:2',
        ])
        self.assertEqual(err.splitlines(), ['store.go:22: Inv.Mem implements Durable in the code, but the spec does not say so '
                                            '(add (implements Durable) to Inv.Mem)'])
        self.assertEqual(code, 1)

    def test_ts_edges(self):
        code, out, err = run_inv(INV_TS, INV_TS_REFS)
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(out.splitlines(), [
            'Inv.Editor -> Durable  # editor.ts:2',
            'Inv.Root -> Inv.Editor  # main.ts:2',
            'Inv.Root -> Inv.Disk  # main.ts:2',
        ])

    def test_behavior_extension_must_match_the_spec(self):
        files = {'s.ts': '// @sbtel Durable\ninterface Durable {}\n// @sbtel Tools\nclass ToolsImpl {}\n'
                         '// @sbtel beh:Tools\ninterface Tools extends Durable {}\n'}
        code, out, err = run_inv(files, 's.ts:6 s.ts:2\tDurable\timplements\n')
        self.assertEqual(err.splitlines(), ['s.ts:6: Tools implements Durable in the code, but the spec does not say so '
                                            '(add (implements Durable) to behavior Tools)'])

    def test_name_of_a_block_and_a_behavior(self):
        # `@sbtel Tools` names the block; `beh:Tools` the behavior, and an edge to it says beh:Tools.
        files = {'t.js': '// @sbtel Tools\nfunction tool() {}\n// @sbtel beh:Tools\nclass ToolsApi {}\n'
                         '// @sbtel Inv.Mem\nfunction use() { tool(); new ToolsApi(); }\n'}
        code, out, err = run_inv(files, 't.js:6 t.js:2\ttool\nt.js:6 t.js:4\tToolsApi\n')
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(out.splitlines(), ['Inv.Mem -> Tools  # t.js:6', 'Inv.Mem -> beh:Tools  # t.js:6'])

    def test_pairs_by_real_path(self):
        # A pair may spell a file's path through a link (TypeScript and the go tool resolve links).
        with tempfile.TemporaryDirectory() as d:
            real, link = os.path.join(d, 'real'), os.path.join(d, 'link')
            os.mkdir(real)
            try:
                os.symlink(real, link)
            except (OSError, NotImplementedError):
                self.skipTest('no symbolic links here')
            with open(os.path.join(real, 'spec.sbtel'), 'w', encoding='utf-8') as f:
                f.write(INV_SPEC)
            for name, text in INV_TS.items():
                with open(os.path.join(real, name), 'w', encoding='utf-8') as f:
                    f.write(text)
            pairs = INV_TS_REFS.replace('editor.ts:', os.path.join(os.path.realpath(real), 'editor.ts') + ':', 1)
            p = subprocess.run([sys.executable, '-I', SCRIPT, 'spec.sbtel'] + list(INV_TS) + ['--edges'], cwd=link,
                               input=pairs, capture_output=True, text=True)
            self.assertEqual(p.stderr, '')
            self.assertIn('Inv.Editor -> Durable  # %s:2' % os.path.join(os.path.realpath(real), 'editor.ts'), p.stdout.splitlines())

    def test_unknown_behavior(self):
        code, _, err = run_inv({'u.js': '// @sbtel Durabel\nconst d = 1;\n'})
        self.assertEqual(err.splitlines(), ['u.js:1: unknown block or behavior Durabel'])


class Sccs(unittest.TestCase):
    def test_components_and_levels(self):
        # Ui -> Doc -> Canvas -> Doc is one SCC; Kit is below everything (level 1); Lone has no edges.
        lines = ['App.Ui -> App.Doc  # a:1', 'App.Doc -> App.Canvas  # a:2', 'App.Canvas -> App.Doc  # a:3',
                 'App.Canvas -> App.Kit  # a:4', '# a comment', '', 'App.Ui App.Kit', 'App.Lone -> App.Lone']
        nodes, edges = sc.read_edges(lines)
        comps = sc.sccs(nodes, edges)
        self.assertIn(['App.Canvas', 'App.Doc'], comps)
        by, isolated = sc.levels(comps, edges)
        named = {d: sorted(sc.label(comps[i]) for i in ix) for d, ix in by.items()}
        self.assertEqual(named, {3: ['App.Ui'], 2: ['[2 nodes: App.Canvas, App.Doc]'], 1: ['App.Kit']})
        self.assertEqual([comps[i] for i in isolated], [['App.Lone']])

    def test_by_file_and_cli(self):
        p = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'sbtel_sccs.py'), '--by-file'],
                           input='a.js:3 b.js:9\nb.js:2 a.js:1\nb.js:4 c.js:1\n', capture_output=True, text=True)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout, '3 nodes, 3 edges, 1 SCC with more than one node\nSCC 1 (2 nodes): a.js b.js\n'
                                   'levels of the condensed graph, top first (level 1 is the lowest):\n  2: [2 nodes: a.js, b.js]\n  1: c.js\n')


if __name__ == '__main__':
    unittest.main(verbosity=1)
