{
  "targets": [
    {
      "target_name": "pg_libpq",
      "sources": [
        "src/exec.cc",
        "src/pg_libpq.cc"
      ],
      'variables': {
        'pgconfig': 'pg_config'
      },
      "include_dirs": [
        '<!@(<(pgconfig) --includedir)',
        "<!(node -e \"require('nan')\")"
      ] ,
      'conditions' : [
        ['OS=="win"', {
          'libraries' : ['libpq.lib'],
          'msvs_settings': {
            'VCLinkerTool' : {
              'AdditionalLibraryDirectories' : [
                '<!@(<(pgconfig) --libdir)\\'
              ]
            },
          }
        }, { # OS!="win"
             'libraries' : ['-lpq -L<!@(<(pgconfig) --libdir)']
           }]
      ]
    }
  ]
}
