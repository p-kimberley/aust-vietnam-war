<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$person = $params["person"];
	$comment = urldecode($params["comment"]);
	$author = get_current_user_id();
	$hostAddress = $_SERVER['REMOTE_ADDR'];
	
	if ($person != null)
	{
        if (empty($comment) || !$author)
		{
			$comment = null;
			$author = null;
		}

		$wpdb->query($wpdb->prepare("CALL add_tribute(%d, %d, %s, %s)", $person, $author, $hostAddress, $comment));

		$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
        $postData = array(
        	'script' => array(
        		'inline' => 'ctx._source.Tributes += tribute',
				'params' => array(
					'tribute' => array(
						'Author' => $author,
						'Host_Address' => $hostAddress,
						'Comment' => $comment,
						'Created' => $currentDateTime
					)
				)
			)
        );

        $result = apiIndexUpdate('avw_nomroll', 'person', $person, $postData);

		echo $result;
	}
	else
	{
		echo 0;
	}
?>
