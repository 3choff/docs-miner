const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode',
    bufferutil: 'bufferutil',
    'utf-8-validate': 'utf-8-validate'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      "canvas": false
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'media',
          to: 'media',
          globOptions: {
            ignore: ['**/*.gif']
          }
        }
      ]
    })
  ],
  ignoreWarnings: [
    {
      module: /yargs|puppeteer-chromium-resolver/
    }
  ],
  node: {
    __dirname: false
  }
};