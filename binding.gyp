{
  "targets": [
    {
      "target_name": "pg_libpq",
      "sources": [
        "src/pg_libpq.cc"
      ],
      'variables': {
        'pgconfig': 'pg_config'
      },
      "include_dirs": [
        '<!@(<(pgconfig) --includedir)',
        "<!(node -e \"require('nan')\")"
      ] ,
      'libraries' : ['-lpq -L<!@(<(pgconfig) --libdir)']
    }
  ]
}
