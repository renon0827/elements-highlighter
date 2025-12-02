// 利用可能な枠色
export type FrameColor = 'red' | 'blue' | 'green' | 'yellow' | 'black';

export const FRAME_COLORS: { value: FrameColor; label: string; hex: string }[] = [
  { value: 'red', label: '赤', hex: '#ff0000' },
  { value: 'blue', label: '青', hex: '#0066ff' },
  { value: 'green', label: '緑', hex: '#00aa00' },
  { value: 'yellow', label: '黄', hex: '#ffaa00' },
  { value: 'black', label: '黒', hex: '#333333' },
];

// 選択された要素の情報
export interface SelectedElement {
  id: string;
  label: string; // 自由入力の番号/ラベル（例: "1", "1-1", "A"など）
  parentId: string | null; // 親要素のID（サブセクションの場合）
  selector: string;
  tagName: string;
  color: FrameColor;
  padding: number; // 枠の余白（px）
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

// メッセージタイプ
export type MessageType =
  | 'START_EDITING'
  | 'STOP_EDITING'
  | 'ELEMENT_SELECTED'
  | 'ELEMENT_REMOVED'
  | 'UPDATE_LABEL'
  | 'EXPORT_IMAGE'
  | 'GET_STATE';

// メッセージ構造
export interface Message {
  type: MessageType;
  payload?: unknown;
}

// 編集状態
export interface EditorState {
  isEditing: boolean;
  elements: SelectedElement[];
}
