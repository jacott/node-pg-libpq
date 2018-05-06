{
  "targets": [
    {
      "target_name": "pg_libpq",
      'variables': {
        'pgconfig': 'pg_config',
      },
      "sources": [ "src/pg-libpq.c" ],
      "include_dirs": [
        '<!@(<(pgconfig) --includedir)'
      ],
      'conditions': [
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
