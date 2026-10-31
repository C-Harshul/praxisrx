import contextlib, io, json, pathlib, tempfile, unittest
from unittest.mock import patch
import acquire

class AcquisitionTests(unittest.TestCase):
    def run_in_temp(self, callback):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/'data').mkdir()
            with patch.object(acquire,'ROOT',root), patch('sys.argv',['acquire','--as-of','2026-10-30']),patch.object(acquire.time,'sleep'):
                callback(root)
    def test_repeat_is_idempotent_and_new_abstract_has_new_version(self):
        record={'id':'123','title':'Phase 2 lung trial','abstractText':'This is a complete short source sentence about a trial.','firstPublicationDate':'2026-09-01'}
        def run(root):
            with patch.object(acquire,'search',return_value=([record],1,'cursor')),contextlib.redirect_stdout(io.StringIO()):
                acquire.main();before=json.loads((root/'data/acquisitions.json').read_text());acquire.main();after=json.loads((root/'data/acquisitions.json').read_text())
                self.assertEqual(len(before['documents']),len(after['documents']))
                record['abstractText']='This is a different short source sentence about a trial.'
                acquire.main();changed=json.loads((root/'data/acquisitions.json').read_text());self.assertGreater(len(changed['documents']),len(after['documents']))
        self.run_in_temp(run)
    def test_partial_and_failed_feed_do_not_advance_watermark_or_stop_other_feeds(self):
        calls=0
        def search(*args):
            nonlocal calls
            calls+=1
            if calls==1: raise TimeoutError()
            return [],3,'cursor'
        def run(root):
            with patch.object(acquire,'search',side_effect=search),contextlib.redirect_stdout(io.StringIO()):acquire.main()
            runs=json.loads((root/'data/acquisitions.json').read_text())['runs'];self.assertEqual(len(runs),7)
            self.assertEqual(runs[0]['status'],'quarantined');self.assertTrue(all(r['watermark'] is None for r in runs));self.assertTrue(all(r['status']=='partial' for r in runs[1:]))
        self.run_in_temp(run)
if __name__=='__main__':unittest.main()
