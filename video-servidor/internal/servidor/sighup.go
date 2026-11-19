package servidor

import (
	"os"
	"os/signal"
	"syscall"
)

// notificarSIGHUP manda o SIGHUP ao canal, e pararSIGHUP desfaz.
func notificarSIGHUP(c chan<- os.Signal) { signal.Notify(c, syscall.SIGHUP) }

func pararSIGHUP(c chan<- os.Signal) { signal.Stop(c) }
