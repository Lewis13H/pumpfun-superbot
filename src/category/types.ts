import { Interpreter, State } from 'xstate';
import { TokenContext, TokenEvent } from './state-machines';

// Define a properly typed service without the complex generic constraints
export type TokenService = Interpreter<TokenContext, any, TokenEvent, any>;

