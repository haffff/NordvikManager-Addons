import { useEffect, useState } from 'react'

// One property, kept in sync: create it if the card has none yet, read it, and follow
// every change (this card's own Set, another player, the GM, an action).
function useProperty(Api, name, defaultValue) {
  const [value, setValue] = useState(defaultValue)
  useEffect(() => {
    const onChange = (property) => setValue(property?.value ?? defaultValue)
    Api.Properties.Subscribe(name, onChange)
    Api.Properties.Init(name, defaultValue)
      .then(() => Api.Properties.Get(name))
      .then(onChange)
    return () => Api.Properties.Unsubscribe(name, onChange)
  }, [Api, name, defaultValue])
  // Values are strings; the property is the truth, so just Set and let Subscribe update the view.
  const save = (next) => Api.Properties.Set(name, String(next))
  return [value, save]
}

export default function App({ Api }) {
  const [name] = useProperty(Api, 'name', 'Unnamed')
  const [hp, setHp] = useProperty(Api, 'hp', '10')
  const [maxHp] = useProperty(Api, 'maxhp', '10')
  const [isGM, setIsGM] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Api.ClientMediator.sendCommandAsync('Game', 'GetIsGM').then(setIsGM, (e) => setError(e.message))
  }, [Api])

  const current = Number(hp) || 0
  const max = Number(maxHp) || 0
  const change = (delta) => setHp(Math.max(0, Math.min(max, current + delta))).catch((e) => setError(e.message))

  // The server rolls; the card only lays out the message. The numbers come from the server.
  const rollCheck = async () => {
    try {
      const { rollId } = await Api.Rolls.Start([{ key: 'check', formula: '1d20' }])
      await Api.Rolls.Finish({
        rollId,
        title: `${name}: check`,
        html: '<div>Check: <b data-roll-key="check"></b></div>',
      })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="hp-card">
      <h1>{name}</h1>
      <div className="hp-value" aria-label="Hit points">
        {current} / {max}
      </div>
      <div className="hp-buttons">
        <button onClick={() => change(-1)}>−1</button>
        <button onClick={() => change(+1)}>+1</button>
        <button onClick={() => setHp(max)}>Full</button>
      </div>
      <div className="hp-buttons">
        <button onClick={rollCheck}>Roll check</button>
        {/* Runs addon_files/Actions/roll_check.json on the server; it gets cardId automatically. */}
        <button onClick={() => Api.FireAction('myaddon/roll_check', {})}>Roll via action</button>
      </div>
      {isGM && <p className="hp-note">You are the GM.</p>}
      {error && <p className="hp-error">{error}</p>}
    </div>
  )
}
