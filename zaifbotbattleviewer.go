package main

import (
	"context"
	"fmt"
	"os"
	"runtime"

	"github.com/tanaton/zaifbotbattleviewer/zbbv"
)

func main() {
	defer func() {
		if err := recover(); err != nil {
			fmt.Fprintf(os.Stderr, "Error:\n%s", err)
			os.Exit(1)
		}
	}()
	os.Exit(_main())
}

func _main() int {
	if envvar := os.Getenv("GOMAXPROCS"); envvar == "" {
		runtime.GOMAXPROCS(runtime.NumCPU())
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	app := zbbv.New()
	if err := app.Run(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "Error:%s\n", err)
		return 1
	}
	return 0
}
