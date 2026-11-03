# hsSimulate v1 시연

**코드 → .hs 파일 열기 → 평가 대상 모듈 → 그래프로 변환** 순서로 진행합니다. **평가 대상**에서 아래 모듈의 `result`를 고르고 캔버스 위 **평가**를 누릅니다. 각 예제는 같은 파일 작업에 추가할 수 있습니다.

| 시연 | 파일 | 확인할 동작 |
| --- | --- | --- |
| 기본 호출 | [Basic.hs](../test/fixtures/source-modules/Basic.hs) | `Basic.result`는 8입니다. Inspector에서 `add` 호출을 고르면 인자 3·5와 반환값 8을 볼 수 있습니다. **처음 / 다음**으로 돌아가 아직 요구하지 않은 값이 미평가로 표시되는지 확인합니다. |
| 재귀와 리스트 | [SeriesExample.hs](../test/fixtures/source-modules/SeriesExample.hs), [Series.hs](../test/fixtures/source-modules/Series.hs), [MathOps.hs](../test/fixtures/source-modules/MathOps.hs) | `SeriesExample.result`는 12입니다. `Series.total`의 첫 호출에서 선택한 `(x:xs)` 방정식과 반환값 8을 확인합니다. 다른 재귀 호출은 별도의 호출 ID와 인자를 표시합니다. |
| 파일 사이 이동 | [Example.hs](../test/fixtures/source-modules/Example.hs), [MathOps.hs](../test/fixtures/source-modules/MathOps.hs) | `Example.result`는 42입니다. `MathOps.add`의 **호출 위치**는 Example.hs, **함수 정의**는 MathOps.hs를 엽니다. **이전 / 다음**에서도 단계별 원문 파일을 확인할 수 있습니다. |
| 오류 복구 | [Failure.hs](../test/fixtures/source-modules/Failure.hs) | `Failure.result`를 실행해 `div 12 0`의 오류와 원문을 확인합니다. 편집기에서 0을 3으로 바꾸고 변환·평가하면 4입니다. |

좁은 화면에서는 캔버스 아래의 **코드**와 **속성** 탭으로 원문과 호출 정보를 오갑니다. 기록 탐색은 완료된 Graph JS 평가를 재생합니다. 계산 중에는 캔버스 위 **계산 중단**을 사용합니다.
