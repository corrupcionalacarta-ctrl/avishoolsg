export default function EstudiarPage() {
  return (
    <div className="space-y-4 mt-4">
      <div>
        <h1 className="text-[20px] font-bold" style={{ color: '#1e293b' }}>Estudiar</h1>
        <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>Material de estudio organizado por prueba</p>
      </div>

      <div className="rounded-2xl p-8 flex flex-col items-center text-center gap-4"
        style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#86efac' }}>menu_book</span>
        <div>
          <p className="font-semibold text-[15px]" style={{ color: '#059669' }}>Próximamente</p>
          <p className="text-[13px] mt-1 leading-5" style={{ color: '#64748b' }}>
            Aquí aparecerán las guías y PDFs del colegio convertidos a texto,
            organizados por asignatura y fecha de evaluación.
          </p>
        </div>
      </div>
    </div>
  )
}
