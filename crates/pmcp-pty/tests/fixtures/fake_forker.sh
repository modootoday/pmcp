#!/bin/sh
# Leaves three kinds of helper behind, as runtimes do: a plain background child (same process
# group), a setsid'd child that stays parented (new session), and a double-forked setsid'd
# one already reparented away. Each pid is written to the directory given as $1.
d=$1
sleep 300 &
echo $! > "$d/grandchild"
setsid sleep 302 &
echo $! > "$d/setsid-child"
(setsid sleep 301 & echo $! > "$d/double-forked")
echo ready
exec sleep 1000
