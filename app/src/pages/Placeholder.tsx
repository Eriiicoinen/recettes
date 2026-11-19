export default function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <div className="empty">{text}</div>
    </section>
  )
}
