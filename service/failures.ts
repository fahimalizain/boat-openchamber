import { clip } from '../shared/json.ts';
import { BoatError } from './boat.ts';

/** How a failure is shown: a status note or a panel banner. */
export type Failure = { text: string; tone: 'warning' | 'error' };

const MAX_MESSAGE_CHARS = 300;

export const describeFailure = (failure: unknown): Failure => {
  if (failure instanceof BoatError) {
    if (failure.code === 'missing-cli') {
      return {
        text: 'The boat CLI was not found. Install it from https://docs.boat.dev, then reopen this panel.',
        tone: 'error',
      };
    }
    if (failure.code === 'not-signed-in') {
      return {
        text: 'The boat CLI is not signed in. Run `boat login` in a terminal, then reopen this panel.',
        tone: 'warning',
      };
    }
    return { text: clip(failure.message, MAX_MESSAGE_CHARS), tone: 'error' };
  }
  return {
    text: clip(failure instanceof Error ? failure.message : 'Boat could not be reached.', MAX_MESSAGE_CHARS),
    tone: 'error',
  };
};
