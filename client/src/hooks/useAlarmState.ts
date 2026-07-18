import { useReducer } from 'react';
import type { AlertMessage } from '../types';

export interface AlarmState {
  alert: AlertMessage | null;
  acknowledged: boolean;
}

export type AlarmAction =
  | { type: 'RAISE'; alert: AlertMessage }
  | { type: 'ACKNOWLEDGE' }
  | { type: 'CLEAR' };

function reducer(state: AlarmState, action: AlarmAction): AlarmState {
  switch (action.type) {
    case 'RAISE':
      return { alert: action.alert, acknowledged: false };
    case 'ACKNOWLEDGE':
      return state.alert ? { ...state, acknowledged: true } : state;
    case 'CLEAR':
      return { alert: null, acknowledged: false };
  }
}

export function useAlarmState() {
  return useReducer(reducer, { alert: null, acknowledged: false });
}
