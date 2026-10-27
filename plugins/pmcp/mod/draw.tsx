/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */

import { runCommand } from "./commands";
import {
  ageOf,
  bandMark,
  blocking,
  detailOf,
  headline,
  holderOf,
  kindOf,
  labelOf,
  LOOK,
  marksOf,
  nameOf,
  placeOf,
  stuck,
  summaryOf,
  TONE,
  toneOf,
  waitingOf,
} from "./model";
import { state } from "./state";

const MARKS = 6;

export async function drawPane($: any, e: any): Promise<any> {
  const { Box, Text, Button, Client } = await $.ui.resolve(e);
  const { pause, lease, records, broadcast } = state.snapshot;
  const tone = TONE[toneOf(state.snapshot)];
  const columns = Math.max(20, Number(e.props?.bodyColumns ?? 80));
  const now = state.now;
  const nameWidth = Math.max(4, ...records.map((r) => labelOf(r).length));
  const placeWidth = Math.max(
    5,
    ...records.map((r) => placeOf(r, state.settings?.worktreeRoot).length),
  );
  const fixed = 2 + nameWidth + 1 + 8 + placeWidth + 1 + MARKS + 5;
  const actionWidth = Math.max(0, columns - fixed);
  const mark = bandMark(state.snapshot);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" backgroundColor={tone.background}>
        {mark.spin ? (
          <Client
            key="spin"
            module="./spinner.tsx"
            props={{ color: tone.color, background: tone.background }}
            width={2}
          />
        ) : (
          <Text key="spin" color={tone.color} backgroundColor={tone.background}>
            {mark.glyph}{" "}
          </Text>
        )}
        {pause ? (
          <Text color="error" bold backgroundColor={tone.background}>
            PAUSED
          </Text>
        ) : (
          <Text color={tone.color} bold backgroundColor={tone.background}>
            sessions
          </Text>
        )}
        <Text backgroundColor={tone.background}>
          {"  "}
          {pause
            ? `${pause.reason} · ${ageOf(pause.since, now)} ago`
            : headline(state.snapshot)}
        </Text>
      </Box>
      {lease ? (
        <Text wrap="truncate-end">
          <Text color="warning">◷ lease for {ageOf(lease.since, now)} </Text>
          <Text>by {holderOf(lease, records)} </Text>
          <Text dimColor>{lease.subject}</Text>
        </Text>
      ) : null}
      {broadcast ? (
        <Text wrap="truncate-end">
          <Text color="suggestion">» broadcast </Text>
          <Text>{broadcast.text}</Text>
        </Text>
      ) : null}
      <Text> </Text>
      {records.length === 0 ? <Text dimColor>No live sessions.</Text> : null}
      {records.map((record) => {
        const look = LOOK[kindOf(record)];
        return (
          <Box key={record.session}>
            <Text wrap="truncate-end">
              <Text color={look.color}>{look.glyph} </Text>
              <Text bold={record.session === state.self}>
                {labelOf(record).padEnd(nameWidth)}{" "}
              </Text>
              <Text color={look.color}>{look.word.padEnd(8)}</Text>
              <Text dimColor>
                {placeOf(record, state.settings?.worktreeRoot).padEnd(
                  placeWidth,
                )}{" "}
              </Text>
              <Text color="warning">{marksOf(record).padEnd(MARKS)}</Text>
              <Text dimColor>
                {ageOf(record.updatedAt, now).padStart(4)}{" "}
                {detailOf(record).slice(0, actionWidth)}
              </Text>
            </Text>
          </Box>
        );
      })}
      <Text> </Text>
      {pause ? (
        <Button
          key="resume"
          label="Resume sessions"
          onPress={() => runCommand($, "resume")}
        />
      ) : (
        <Text dimColor>
          /pmcp pause &lt;reason&gt; · /pmcp broadcast &lt;text&gt;
        </Text>
      )}
    </Box>
  );
}

function row(key: string, Box: any, Text: any, children: any): any {
  return (
    <Box key={key}>
      <Text wrap="truncate-end">{children}</Text>
    </Box>
  );
}

export async function drawBand($: any, e: any, next: any): Promise<any> {
  if (e.props?.hasSurvey) return next(e);
  const { pause, lease, records } = state.snapshot;
  const waiting = blocking(records);
  const heard = state.snapshot.broadcast;
  const broadcast = heard?.by === state.self ? null : heard;
  const held = lease && stuck(lease) ? lease : null;
  const { Box, Text, Client } = await $.ui.resolve(e);
  const tone = TONE[toneOf(state.snapshot)];
  const mark = bandMark(state.snapshot);
  const rows = [];
  const summary = (
    <Box key="summary" flexDirection="row" backgroundColor={tone.background}>
      {mark.spin ? (
        <Client
          key="spin"
          module="./spinner.tsx"
          props={{ color: tone.color, background: tone.background }}
          width={2}
        />
      ) : (
        <Text key="spin" color={tone.color} backgroundColor={tone.background}>
          {mark.glyph}{" "}
        </Text>
      )}
      <Text wrap="truncate-end" backgroundColor={tone.background}>
        <Text bold color={tone.color}>
          pmcp{" "}
        </Text>
        <Text>{summaryOf(state.snapshot)}</Text>
        <Text dimColor> · /pmcp </Text>
      </Text>
    </Box>
  );
  if (pause) {
    rows.push(
      row("pause", Box, Text, [
        <Text key="mark" color="error" bold>
          ■ paused{" "}
        </Text>,
        <Text key="reason">{pause.reason}</Text>,
        <Text key="hint" dimColor>
          {" "}
          · /pmcp resume
        </Text>,
      ]),
    );
  }
  if (waiting.length > 0) {
    const names = waiting.map((r) => `${nameOf(r)} (${waitingOf(r)})`);
    rows.push(
      row("asking", Box, Text, [
        <Text key="mark" color="permission" bold>
          ◆ asking{" "}
        </Text>,
        <Text key="names">{names.join(", ")}</Text>,
      ]),
    );
  }
  if (held) {
    rows.push(
      row("lease", Box, Text, [
        <Text key="mark" color="warning">
          ◷ lease held for {ageOf(held.since, state.now)}{" "}
        </Text>,
        <Text key="holder">by {holderOf(held, records)} </Text>,
        <Text key="subject" dimColor>
          {held.subject}
        </Text>,
      ]),
    );
  }
  if (broadcast) {
    rows.push(
      row("broadcast", Box, Text, [
        <Text key="mark" color="suggestion">
          » broadcast{" "}
        </Text>,
        <Text key="text">{broadcast.text}</Text>,
      ]),
    );
  }
  // Prioritize actionable states because narrow status bands cannot display every summary.
  const room = Math.max(1, Number(e.props?.maxRows ?? rows.length + 1));
  const shown = room > rows.length ? [summary, ...rows] : rows.slice(0, room);
  return <Box flexDirection="column">{shown}</Box>;
}
