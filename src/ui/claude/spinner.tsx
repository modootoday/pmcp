/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
// Use an independent animation clock so spinner motion does not redraw the whole sessions pane.
import type { ClientModule } from "claude-code";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 120;

type Props = { color: string; background: string };
type State = { frame: number };

const Spinner: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements;
  if (surface.state === undefined) {
    surface.every(FRAME_MS, () => {
      const frame = ((surface.state?.frame ?? 0) + 1) % FRAMES.length;
      surface.setState({ frame });
    });
    surface.setState({ frame: 0 });
  }
  const frame = surface.state?.frame ?? 0;
  return (
    <Text color={props.color} backgroundColor={props.background} bold>
      {FRAMES[frame]}{" "}
    </Text>
  );
};

export default Spinner;
