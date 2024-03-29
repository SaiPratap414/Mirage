/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismIdHandle } from '../id/cubismid';
import { CubismFramework } from '../live2dcubismframework';
import { CubismModel } from '../model/cubismmodel';
import { csmVector } from '../type/csmvector';
import { CubismJson, Value } from '../utils/cubismjson';
import { ACubismMotion } from './acubismmotion';
import { CubismMotionQueueEntry } from './cubismmotionqueueentry';

// exp3.jsonのキーとデフォルト
const ExpressionKeyFadeIn = 'FadeInTime';
const ExpressionKeyFadeOut = 'FadeOutTime';
const ExpressionKeyParameters = 'Parameters';
const ExpressionKeyId = 'Id';
const ExpressionKeyValue = 'Value';
const ExpressionKeyBlend = 'Blend';
const BlendValueAdd = 'Add';
const BlendValueMultiply = 'Multiply';
const BlendValueOverwrite = 'Overwrite';
const DefaultFadeTime = 1.0;

/**
 * 表情のモーション
 *
 * 表情のモーションクラス。
 */
export class CubismExpressionMotion extends ACubismMotion {
  static readonly DefaultAdditiveValue = 0.0; // 加算適用の初期値
  static readonly DefaultMultiplyValue = 1.0; // 乗算適用の初期値

  /**
   * インスタンスを作成する。
   * @param buffer expファイルが読み込まれているバッファ
   * @param size バッファのサイズ
   * @return 作成されたインスタンス
   */
  public static create(
    buffer: ArrayBuffer,
    size: number
  ): CubismExpressionMotion {
    const expression: CubismExpressionMotion = new CubismExpressionMotion();
    expression.parse(buffer, size);
    return expression;
  }

  /**
   * モデルのパラメータの更新の実行
   * @param model 対象のモデル
   * @param userTimeSeconds デルタ時間の積算値[秒]
   * @param weight モーションの重み
   * @param motionQueueEntry CubismMotionQueueManagerで管理されているモーション
   */
  public doUpdateParameters(
    model: CubismModel,
    userTimeSeconds: number,
    weight: number,
    motionQueueEntry: CubismMotionQueueEntry
  ): void {
    for (let i = 0; i < this._parameters.getSize(); ++i) {
      const parameter: ExpressionParameter = this._parameters.at(i);

      switch (parameter.blendType) {
        case ExpressionBlendType.Additive: {
          model.addParameterValueById(
            parameter.parameterId,
            parameter.value,
            weight
          );
          break;
        }
        case ExpressionBlendType.Multiply: {
          model.multiplyParameterValueById(
            parameter.parameterId,
            parameter.value,
            weight
          );
          break;
        }
        case ExpressionBlendType.Overwrite: {
          model.setParameterValueById(
            parameter.parameterId,
            parameter.value,
            weight
          );
          break;
        }
        default:
          // 仕様にない値を設定した時はすでに加算モードになっている
          break;
      }
    }
  }

  /**
   * @brief 表情によるモデルのパラメータの計算
   *
   * モデルの表情に関するパラメータを計算する。
   *
   * @param[in]   model                        対象のモデル
   * @param[in]   userTimeSeconds              デルタ時間の積算値[秒]
   * @param[in]   motionQueueEntry             CubismMotionQueueManagerで管理されているモーション
   * @param[in]   expressionParameterValues    モデルに適用する各パラメータの値
   * @param[in]   expressionIndex              表情のインデックス
   */
  public calculateExpressionParameters(
    model: CubismModel,
    userTimeSeconds: number,
    motionQueueEntry: CubismMotionQueueEntry,
    expressionParameterValues: csmVector<ExpressionParameterValue>,
    expressionIndex: number
  ) {
    if (!motionQueueEntry.isAvailable()) {
      return;
    }

    if (!motionQueueEntry.isStarted()) {
      motionQueueEntry.setIsStarted(true);
      motionQueueEntry.setStartTime(userTimeSeconds - this._offsetSeconds); // モーションの開始時刻を記録
      motionQueueEntry.setFadeInStartTime(userTimeSeconds); // フェードインの開始時刻

      const duration = this.getDuration();

      if (motionQueueEntry.getEndTime() < 0.0) {
        // 開始していないうちに終了設定している場合がある
        motionQueueEntry.setEndTime(
          duration <= 0.0 ? -1 : motionQueueEntry.getStartTime() + duration
        );
        // duration == -1 の場合はループする
      }
    }

    this._fadeWeight = this.updateFadeWeight(motionQueueEntry, userTimeSeconds);

    // モデルに適用する値を計算
    for (let i = 0; i < expressionParameterValues.getSize(); ++i) {
      const expressionParameterValue = expressionParameterValues.at(i);

      if (expressionParameterValue.parameterId == null) {
        continue;
      }

      const currentParameterValue = (expressionParameterValue.overwriteValue =
        model.getParameterValueById(expressionParameterValue.parameterId));

      const expressionParameters = this.getExpressionParameters();
      let parameterIndex = -1;
      for (let j = 0; j < expressionParameters.getSize(); ++j) {
        if (
          expressionParameterValue.parameterId !=
          expressionParameters.at(j).parameterId
        ) {
          continue;
        }

        parameterIndex = j;

        break;
      }

      // 再生中のExpressionが参照していないパラメータは初期値を適用
      if (parameterIndex < 0) {
        if (expressionIndex == 0) {
          expressionParameterValue.additiveValue =
            CubismExpressionMotion.DefaultAdditiveValue;
          expressionParameterValue.multiplyValue =
            CubismExpressionMotion.DefaultMultiplyValue;
          expressionParameterValue.overwriteValue = currentParameterValue;
        } else {
          expressionParameterValue.additiveValue = this.calculateValue(
            expressionParameterValue.additiveValue,
            CubismExpressionMotion.DefaultAdditiveValue
          );
          expressionParameterValue.multiplyValue = this.calculateValue(
            expressionParameterValue.multiplyValue,
            CubismExpressionMotion.DefaultMultiplyValue
          );
          expressionParameterValue.overwriteValue = this.calculateValue(
            expressionParameterValue.overwriteValue,
            currentParameterValue
          );
        }
        continue;
      }

      // 値を計算
      const value = expressionParameters.at(parameterIndex).value;
      let newAdditiveValue, newMultiplyValue, newOverwriteValue;
      switch (expressionParameters.at(parameterIndex).blendType) {
        case ExpressionBlendType.Additive:
          newAdditiveValue = value;
          newMultiplyValue = CubismExpressionMotion.DefaultMultiplyValue;
          newOverwriteValue = currentParameterValue;
          break;

        case ExpressionBlendType.Multiply:
          newAdditiveValue = CubismExpressionMotion.DefaultAdditiveValue;
          newMultiplyValue = value;
          newOverwriteValue = currentParameterValue;
          break;

        case ExpressionBlendType.Overwrite:
          newAdditiveValue = CubismExpressionMotion.DefaultAdditiveValue;
          newMultiplyValue = CubismExpressionMotion.DefaultMultiplyValue;
          newOverwriteValue = value;
          break;

        default:
          return;
      }

      if (expressionIndex == 0) {
        expressionParameterValue.additiveValue = newAdditiveValue;
        expressionParameterValue.multiplyValue = newMultiplyValue;
        expressionParameterValue.overwriteValue = newOverwriteValue;
      } else {
        expressionParameterValue.additiveValue =
          expressionParameterValue.additiveValue * (1.0 - this._fadeWeight) +
          newAdditiveValue * this._fadeWeight;
        expressionParameterValue.multiplyValue =
          expressionParameterValue.multiplyValue * (1.0 - this._fadeWeight) +
          newMultiplyValue * this._fadeWeight;
        expressionParameterValue.overwriteValue =
          expressionParameterValue.overwriteValue * (1.0 - this._fadeWeight) +
          newOverwriteValue * this._fadeWeight;
      }
    }
  }

  /**
   * @brief 表情が参照しているパラメータを取得
   *
   * 表情が参照しているパラメータを取得する
   *
   * @return 表情パラメータ
   */
  public getExpressionParameters() {
    return this._parameters;
  }

  /**
   * @brief 表情のフェードの値を取得
   *
   * 現在の表情のフェードのウェイト値を取得する
   *
   * @returns 表情のフェードのウェイト値
   */
  public getFadeWeight() {
    return this._fadeWeight;
  }

  protected parse(buffer: ArrayBuffer, size: number) {
    const json: CubismJson = CubismJson.create(buffer, size);
    if (!json) {
      return;
    }

    const root: Value = json.getRoot();

    this.setFadeInTime(
      root.getValueByString(ExpressionKeyFadeIn).toFloat(DefaultFadeTime)
    ); // フェードイン
    this.setFadeOutTime(
      root.getValueByString(ExpressionKeyFadeOut).toFloat(DefaultFadeTime)
    ); // フェードアウト

    // 各パラメータについて
    const parameterCount = root
      .getValueByString(ExpressionKeyParameters)
      .getSize();
    this._parameters.prepareCapacity(parameterCount);

    for (let i = 0; i < parameterCount; ++i) {
      const param: Value = root
        .getValueByString(ExpressionKeyParameters)
        .getValueByIndex(i);
      const parameterId: CubismIdHandle = CubismFramework.getIdManager().getId(
        param.getValueByString(ExpressionKeyId).getRawString()
      ); // パラメータID

      const value: number = param
        .getValueByString(ExpressionKeyValue)
        .toFloat(); // 値

      // 計算方法の設定
      let blendType: ExpressionBlendType;

      if (
        param.getValueByString(ExpressionKeyBlend).isNull() ||
        param.getValueByString(ExpressionKeyBlend).getString() == BlendValueAdd
      ) {
        blendType = ExpressionBlendType.Additive;
      } else if (
        param.getValueByString(ExpressionKeyBlend).getString() ==
        BlendValueMultiply
      ) {
        blendType = ExpressionBlendType.Multiply;
      } else if (
        param.getValueByString(ExpressionKeyBlend).getString() ==
        BlendValueOverwrite
      ) {
        blendType = ExpressionBlendType.Overwrite;
      } else {
        // その他 仕様にない値を設定した時は加算モードにすることで復旧
        blendType = ExpressionBlendType.Additive;
      }

      // 設定オブジェクトを作成してリストに追加する
      const item: ExpressionParameter = new ExpressionParameter();

      item.parameterId = parameterId;
      item.blendType = blendType;
      item.value = value;

      this._parameters.pushBack(item);
    }

    CubismJson.delete(json); // JSONデータは不要になったら削除する
  }

  /**
   * @brief ブレンド計算
   *
   * 入力された値でブレンド計算をする。
   *
   * @param source 現在の値
   * @param destination 適用する値
   * @param weight ウェイト
   * @returns 計算結果
   */
  public calculateValue(source: number, destination: number): number {
    return source * (1.0 - this._fadeWeight) + destination * this._fadeWeight;
  }

  /**
   * コンストラクタ
   */
  protected constructor() {
    super();
    this._parameters = new csmVector<ExpressionParameter>();
    this._fadeWeight = 0.0;
  }

  private _parameters: csmVector<ExpressionParameter>; // 表情のパラメータ情報リスト
  private _fadeWeight: number; // 表情の現在のウェイト
}

/**
 * 表情パラメータ値の計算方式
 */
export enum ExpressionBlendType {
  Additive = 0, // 加算
  Multiply = 1, // 乗算
  Overwrite = 2 // 上書き
}

/**
 * 表情のパラメータ情報
 */
export class ExpressionParameter {
  parameterId: CubismIdHandle; // パラメータID
  blendType: ExpressionBlendType; // パラメータの演算種類
  value: number; // 値
}

// Namespace definition for compatibility.
import * as $ from './cubismexpressionmotion';
import { ExpressionParameterValue } from './cubismexpressionmotionmanager';
import { CubismDefaultParameterId } from '../cubismdefaultparameterid';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismExpressionMotion = $.CubismExpressionMotion;
  export type CubismExpressionMotion = $.CubismExpressionMotion;
  export const ExpressionBlendType = $.ExpressionBlendType;
  export type ExpressionBlendType = $.ExpressionBlendType;
  export const ExpressionParameter = $.ExpressionParameter;
  export type ExpressionParameter = $.ExpressionParameter;
}
