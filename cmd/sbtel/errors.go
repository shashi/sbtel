// @sbtel file Sbtel.Cli.Kit

package main

import "errors"

var (
	errNoSpec   = errors.New("no spec given")
	errTwoStdin = errors.New("- (stdin) can stand for one input only")
)
