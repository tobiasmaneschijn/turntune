import { randomInt } from 'node:crypto'
import type { ChatGame } from '../../../shared/chat-attachments.js'
import type { ChatTriviaState } from '../../../shared/chat-trivia.js'
import { PublicRequestError } from '../../lib/public-request-error.js'

export const CHAT_TRIVIA_DURATION_MS = 30_000
export const CHAT_TRIVIA_MAX_PLAYERS = 300
type TriviaRound = NonNullable<Extract<ChatGame, { kind: 'trivia' }>['round']>

// IDs and answers are append-only: saved rounds must remain playable after updates.
// The bank stays on the server; public messages never contain the correct answer.
const questions = [
  ['thriller-artist', 'Who released the album Thriller?', 'Michael Jackson', 'Prince', 'Stevie Wonder', 'Lionel Richie'],
  ['bohemian-band', 'Which band recorded Bohemian Rhapsody?', 'Queen', 'Pink Floyd', 'Led Zeppelin', 'The Who'],
  ['piano-keys', 'How many keys does a standard full-size piano have?', '88', '76', '61', '96'],
  ['guitar-strings', 'How many strings does a standard guitar have?', 'Six', 'Four', 'Five', 'Eight'],
  ['bpm-meaning', 'What does BPM measure in music?', 'Tempo', 'Pitch', 'Volume', 'Key'],
  ['abbey-road-band', 'Which band released Abbey Road?', 'The Beatles', 'The Rolling Stones', 'The Kinks', 'The Beach Boys'],
  ['beatles-city', 'In which city did The Beatles form?', 'Liverpool', 'Manchester', 'London', 'Birmingham'],
  ['four-seasons-composer', 'Who composed The Four Seasons?', 'Antonio Vivaldi', 'Johann Sebastian Bach', 'Wolfgang Amadeus Mozart', 'Franz Schubert'],
  ['moonlight-composer', 'Who composed the Moonlight Sonata?', 'Ludwig van Beethoven', 'Frédéric Chopin', 'Claude Debussy', 'Johannes Brahms'],
  ['miles-instrument', 'Which instrument was Miles Davis best known for playing?', 'Trumpet', 'Saxophone', 'Piano', 'Double bass'],
  ['daft-punk-country', 'In which country did Daft Punk form?', 'France', 'Germany', 'Italy', 'Sweden'],
  ['concert-a', 'What is the usual concert pitch for A above middle C?', '440 Hz', '220 Hz', '880 Hz', '330 Hz'],
  ['octave-semitones', 'How many semitones are in an octave?', '12', '7', '8', '10'],
  ['sharp-sign', 'What does a sharp sign do to a note?', 'Raises it by a semitone', 'Lowers it by a semitone', 'Doubles its length', 'Makes it louder'],
  ['treble-clef', 'Which note gives the treble clef its other name?', 'G', 'F', 'C', 'A'],
  ['pianissimo', 'What does pianissimo mean?', 'Very softly', 'Very loudly', 'Very quickly', 'Very slowly'],
  ['adagio', 'What does the tempo marking adagio mean?', 'Slowly', 'Quickly', 'Getting faster', 'Getting louder'],
  ['elton-instrument', 'Which instrument is Elton John best known for playing?', 'Piano', 'Guitar', 'Drums', 'Violin'],
  ['saxophone-family', 'Which instrument family includes the saxophone?', 'Woodwind', 'Brass', 'Strings', 'Percussion'],
  ['a-cappella', 'What does a cappella mean?', 'Singing without instruments', 'Playing without a conductor', 'Singing very quietly', 'Playing at double speed'],
] as const

export interface TriviaAnswer { userId: string; optionIndex: number }

export function createTriviaRound(now = Date.now(), draw = randomInt): Extract<ChatGame, { kind: 'trivia' }> {
  const [questionId, question, correct, ...others] = questions[draw(0, questions.length)]
  const options: string[] = [correct, ...others]
  for (let index = options.length - 1; index > 0; index--) {
    const swap = draw(0, index + 1)
    ;[options[index], options[swap]] = [options[swap], options[index]]
  }
  return { kind: 'trivia', round: { questionId, question, options, endsAt: new Date(now + CHAT_TRIVIA_DURATION_MS).toISOString() } }
}

function correctOption(round: TriviaRound) {
  const question = questions.find(([id]) => id === round.questionId)
  if (!question || question[1] !== round.question || round.options.length !== 4 ||
    !question.slice(2).every(option => round.options.includes(option))) throw new PublicRequestError('This trivia round is unavailable.', 404)
  return round.options.indexOf(question[2])
}

/** The first recorded answer wins, including a retry received after the deadline. */
export function addTriviaAnswer(round: TriviaRound, answers: TriviaAnswer[], userId: string, optionIndex: number, now: number) {
  correctOption(round)
  if (answers.some(answer => answer.userId === userId)) return
  if (Date.parse(round.endsAt) <= now) throw new PublicRequestError('This trivia round has ended.', 409)
  if (answers.length >= CHAT_TRIVIA_MAX_PLAYERS) throw new PublicRequestError('This trivia round is full.', 429)
  answers.push({ userId, optionIndex })
}

export function triviaState(messageId: string, round: TriviaRound, answers: TriviaAnswer[], userId: string, now: number): ChatTriviaState {
  const correct = correctOption(round)
  const state: ChatTriviaState = { messageId, endsAt: round.endsAt, serverNow: new Date(now).toISOString(),
    answered: answers.length, selectedOption: answers.find(answer => answer.userId === userId)?.optionIndex }
  if (Date.parse(round.endsAt) <= now) {
    state.correctOption = correct
    state.counts = round.options.map((_, index) => answers.filter(answer => answer.optionIndex === index).length)
  }
  return state
}
